import { supabase } from '@/lib/supabase';

export interface BoundingBox {
  x: number; // 0-100% of image width
  y: number; // 0-100% of image height
  w: number;
  h: number;
}

export interface SignatureElement {
  name: string | null;
  title: string | null;
  company: string | null;
  type: 'wet-ink' | 'digital' | 'unknown';
  description: string | null;
  boundingBox: BoundingBox | null;
}

export interface StampElement {
  type: 'company-seal' | 'official-stamp' | 'date-stamp' | 'chop' | 'notary' | 'other';
  text: string | null;
  company: string | null;
  description: string | null;
  boundingBox: BoundingBox | null;
}

export interface VisualElements {
  signatures: SignatureElement[];
  stamps: StampElement[];
  hasSignatures: boolean;
  hasStamps: boolean;
  notes: string | null;
}

export interface StoredSignature {
  id: string;
  board_resolution_id: string | null;
  person_name: string | null;
  company_name: string | null;
  element_type: 'signature' | 'seal' | 'stamp';
  signature_type: string;
  storage_path: string;
  storage_url: string | null;
  page_number: number;
  bounding_box: BoundingBox | null;
  created_at: string;
}

const PADDING = 3; // % padding around each cropped region

/** Crops a rectangular region from an image data URL, returns a JPEG data URL. */
export async function cropImageRegion(
  imageDataUrl: string,
  bbox: BoundingBox,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const pw = img.naturalWidth;
      const ph = img.naturalHeight;

      const xPct = Math.max(0, bbox.x - PADDING);
      const yPct = Math.max(0, bbox.y - PADDING);
      const wPct = Math.min(100 - xPct, bbox.w + PADDING * 2);
      const hPct = Math.min(100 - yPct, bbox.h + PADDING * 2);

      const sx = Math.round((xPct / 100) * pw);
      const sy = Math.round((yPct / 100) * ph);
      const sw = Math.max(1, Math.round((wPct / 100) * pw));
      const sh = Math.max(1, Math.round((hPct / 100) * ph));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
      canvas.remove();
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageDataUrl;
  });
}

/** Converts a data URL to a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Uploads a JPEG data URL to the signatures storage bucket, returns public URL. */
export async function uploadSignatureImage(
  jpegDataUrl: string,
  storagePath: string,
): Promise<string> {
  const blob = dataUrlToBlob(jpegDataUrl);
  const { error } = await supabase.storage
    .from('signatures')
    .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from('signatures').getPublicUrl(storagePath);
  return data.publicUrl;
}

interface ProcessResult {
  id: string;
  visualElements: VisualElements | null;
  boardResolutionDetails?: { companyName: string | null } | null;
  error?: string;
}

interface DocumentFile {
  id: string;
  file: File;
  // page images lazily rendered below
}

/** Renders all pages of a PDF (or the image itself) as data URLs. */
async function renderDocumentPages(file: File): Promise<string[]> {
  if (file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve([reader.result as string]);
      reader.readAsDataURL(file);
    });
  }
  const { convertPDFToImages } = await import('@/lib/pdfUtils');
  return convertPDFToImages(file, 150);
}

/**
 * After document-processor-agent returns results, this function:
 * 1. Renders each document to page images
 * 2. Crops each signature/stamp bounding box
 * 3. Uploads PNGs to Supabase Storage
 * 4. Inserts rows into document_signatures
 *
 * Returns a map of result.id → array of StoredSignature rows inserted.
 */
export async function extractAndStoreSignatures(
  results: ProcessResult[],
  docFiles: DocumentFile[],
  brIdMap: Map<string, string>, // docId → board_resolution_id
): Promise<Map<string, StoredSignature[]>> {
  const stored = new Map<string, StoredSignature[]>();

  for (const result of results) {
    if (result.error || !result.visualElements) continue;
    const { signatures, stamps } = result.visualElements;
    const hasAnything =
      signatures.some((s) => s.boundingBox) || stamps.some((s) => s.boundingBox);
    if (!hasAnything) continue;

    const docFile = docFiles.find((d) => d.id === result.id);
    if (!docFile) continue;

    const companyName = result.boardResolutionDetails?.companyName ?? null;
    const brId = brIdMap.get(result.id) ?? null;

    let pages: string[];
    try {
      pages = await renderDocumentPages(docFile.file);
    } catch {
      continue;
    }

    const pageImage = pages[0]; // use first page for all elements (single-page assumption)
    const rows: StoredSignature[] = [];

    const processElement = async (
      elementType: 'signature' | 'seal' | 'stamp',
      bbox: BoundingBox,
      personName: string | null,
      sigType: string,
      index: number,
    ) => {
      try {
        const jpegDataUrl = await cropImageRegion(pageImage, bbox);
        const slug = (personName ?? elementType)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 40);
        const storagePath = `${brId ?? result.id}/${elementType}/${slug}-${index}.jpg`;
        const storageUrl = await uploadSignatureImage(jpegDataUrl, storagePath);

        const row = {
          board_resolution_id: brId,
          person_name: personName,
          company_name: companyName,
          element_type: elementType,
          signature_type: sigType,
          storage_path: storagePath,
          storage_url: storageUrl,
          page_number: 1,
          bounding_box: bbox,
        };

        const { data, error } = await supabase
          .from('document_signatures')
          .insert(row)
          .select()
          .single();

        if (!error && data) rows.push(data as StoredSignature);

        // For signature elements, write the URL directly to company_mandates so
        // it is immediately accessible without a join on document_signatures.
        if (elementType === 'signature' && personName && companyName) {
          await supabase
            .from('company_mandates')
            .update({ signature_url: storageUrl, last_updated: new Date().toISOString() })
            .eq('company_name', companyName)
            .ilike('director_name', personName);
        }
      } catch (e) {
        console.error('Signature crop/upload error:', e);
      }
    };

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      if (!sig.boundingBox) continue;
      await processElement('signature', sig.boundingBox, sig.name, sig.type, i);
    }

    for (let i = 0; i < stamps.length; i++) {
      const stamp = stamps[i];
      if (!stamp.boundingBox) continue;
      const elementType = stamp.type === 'company-seal' ? 'seal' : 'stamp';
      await processElement(elementType, stamp.boundingBox, stamp.text, 'stamp', i);
    }

    if (rows.length > 0) stored.set(result.id, rows);
  }

  return stored;
}
