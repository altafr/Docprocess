

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader as Loader2, Upload, FileImage, FileText, Copy, Download, Tag, Building2, MapPin, Users, Hash, Calendar, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { extractTextFromPDF, isScannedPDF, convertPDFToImages, extractPDFMetadata, type PDFMetadata } from '@/lib/pdfUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

type OCRProvider = 'replicate' | 'openrouter' | 'mistral' | 'llamaparse';
type OCRModel =
  | 'openai/gpt-4o'
  | 'openai/gpt-4o-mini'
  | 'openai/o1'
  | 'anthropic/claude-sonnet-4'
  | 'anthropic/claude-opus-4'
  | 'anthropic/claude-3.5-haiku-20241022';

export function DataExtraction() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [ocrProvider, setOcrProvider] = useState<OCRProvider>('replicate');
  const [ocrModel, setOcrModel] = useState<OCRModel>('openai/gpt-4o');
  const [results, setResults] = useState<{
    plainText: string;
    jsonData: any;
    visualizationUrl?: string;
    processingMethod?: 'text-extraction' | 'ocr' | 'scanned-pdf-ocr';
    metadata?: PDFMetadata;
    processingTime?: number;
    provider?: string;
    classification?: { category: string; confidence: number };
    brDetails?: {
      companyName: string | null;
      address: string | null;
      directors: string[];
      registrationNumber: string | null;
      dateOfIncorporation: string | null;
      businessNature: string | null;
    } | null;
  } | null>(null);

  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > MAX_FILE_SIZE) {
        toast({
          title: 'File too large',
          description: 'Please upload a file smaller than 5MB',
          variant: 'destructive',
        });
        return;
      }

      const isImage = selectedFile.type.startsWith('image/');
      const isPDF = selectedFile.type === 'application/pdf';

      if (!isImage && !isPDF) {
        toast({
          title: 'Invalid file type',
          description: 'Please upload an image (PNG, JPG) or PDF file',
          variant: 'destructive',
        });
        return;
      }
      setFile(selectedFile);
      setResults(null);
    }
  };

  const processPDF = async () => {
    if (!file) return;

    const startTime = Date.now();
    setLoading(true);
    setProcessingStatus('Analyzing PDF...');

    try {
      const metadata = await extractPDFMetadata(file);
      setProcessingStatus('Extracting text...');

      const extractedText = await extractTextFromPDF(file);
      const isScanned = isScannedPDF(extractedText, file);

      if (!isScanned) {
        setProcessingStatus('Classifying document...');
        const { callEdgeFunction } = await import('@/lib/supabase');
        let classification: { category: string; confidence: number } | undefined;
        let brDetails: any;
        try {
          const classifyData = await callEdgeFunction('data-extraction', {
            imageUrl: 'classify-only',
            provider: ocrProvider,
            textContent: extractedText,
          });
          classification = classifyData.classification;
          brDetails = classifyData.brDetails;
        } catch {
          // classification is optional
        }

        const processingTime = Date.now() - startTime;

        setResults({
          plainText: extractedText,
          jsonData: {
            text: extractedText,
            method: 'text-extraction',
            pages: metadata.numPages,
            processingTime: `${(processingTime / 1000).toFixed(2)}s`
          },
          processingMethod: 'text-extraction',
          metadata,
          processingTime,
          classification,
          brDetails,
        });

        setLoading(false);
        toast({
          title: 'Text extraction complete',
          description: `Extracted text from ${metadata.numPages} page${metadata.numPages > 1 ? 's' : ''}`,
        });
      } else {
        const { callEdgeFunction } = await import('@/lib/supabase');
        const supportsPdfDirect = ocrProvider === 'mistral' || ocrProvider === 'llamaparse';

        if (supportsPdfDirect) {
          setProcessingStatus(`Sending PDF to ${ocrProvider} for OCR processing...`);
          const pdfReader = new FileReader();
          const base64Pdf = await new Promise<string>((resolve, reject) => {
            pdfReader.onloadend = () => resolve(pdfReader.result as string);
            pdfReader.onerror = () => reject(new Error('Failed to read PDF'));
            pdfReader.readAsDataURL(file);
          });

          const data = await callEdgeFunction('data-extraction', {
            imageUrl: base64Pdf,
            provider: ocrProvider,
          });

          const processingTime = Date.now() - startTime;

          setResults({
            plainText: data.extractedText || 'No text extracted',
            jsonData: data.jsonData || {},
            processingMethod: 'scanned-pdf-ocr',
            metadata,
            processingTime,
            provider: data.provider || ocrProvider,
            classification: data.classification,
            brDetails: data.brDetails,
          });

          setLoading(false);
          setProcessingStatus('');
          toast({
            title: 'OCR processing complete',
            description: `Processed ${metadata.numPages} scanned page${metadata.numPages > 1 ? 's' : ''}`,
          });
        } else {
          setProcessingStatus(`Converting PDF to images (${metadata.numPages} page${metadata.numPages > 1 ? 's' : ''})...`);
          const pageImages = await convertPDFToImages(file);

          let combinedText = '';

          for (let i = 0; i < pageImages.length; i++) {
            setProcessingStatus(`Processing page ${i + 1} of ${pageImages.length} with OCR (${ocrProvider})...`);

            const data = await callEdgeFunction('data-extraction', {
              imageUrl: pageImages[i],
              provider: ocrProvider,
              model: ocrProvider === 'openrouter' ? ocrModel : undefined,
            });

            if (data.extractedText) {
              combinedText += `\n--- Page ${i + 1} ---\n${data.extractedText}\n`;
            }
          }

          setProcessingStatus('Classifying document...');
          let classification: { category: string; confidence: number } | undefined;
          let brDetails: any;
          try {
            const classifyData = await callEdgeFunction('data-extraction', {
              imageUrl: 'classify-only',
              provider: ocrProvider,
              textContent: combinedText,
            });
            classification = classifyData.classification;
            brDetails = classifyData.brDetails;
          } catch {
            // classification is optional
          }

          const processingTime = Date.now() - startTime;

          setResults({
            plainText: combinedText.trim() || 'No text extracted',
            jsonData: {
              text: combinedText.trim() || 'No text extracted',
              method: 'scanned-pdf-ocr',
              pages: metadata.numPages,
              processingTime: `${(processingTime / 1000).toFixed(2)}s`
            },
            processingMethod: 'scanned-pdf-ocr',
            metadata,
            processingTime,
            classification,
            brDetails,
          });

          setLoading(false);
          setProcessingStatus('');
          toast({
            title: 'OCR processing complete',
            description: `Processed ${metadata.numPages} scanned page${metadata.numPages > 1 ? 's' : ''}`,
          });
        }
      }
    } catch (error: any) {
      setLoading(false);
      setProcessingStatus('');
      toast({
        title: 'Processing failed',
        description: error.message || 'Failed to process PDF. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const processImage = async () => {
    if (!file) return;

    const startTime = Date.now();
    setLoading(true);
    setProcessingStatus(`Extracting data from image using ${ocrProvider}...`);

    try {
      const reader = new FileReader();

      reader.onloadend = async () => {
        try {
          const base64Image = reader.result as string;

          const { callEdgeFunction } = await import('@/lib/supabase');
          const data = await callEdgeFunction('data-extraction', {
            imageUrl: base64Image,
            provider: ocrProvider,
            model: ocrProvider === 'openrouter' ? ocrModel : undefined,
          });

          const processingTime = Date.now() - startTime;

          setResults({
            plainText: data.extractedText || 'No text extracted',
            jsonData: data.jsonData || {},
            visualizationUrl: data.visualizationUrl || '',
            processingMethod: 'ocr',
            processingTime,
            provider: data.provider || ocrProvider,
            classification: data.classification,
            brDetails: data.brDetails,
          });

          setLoading(false);
          setProcessingStatus('');
          toast({
            title: 'Extraction complete',
            description: 'Data has been successfully extracted from your image.',
          });
        } catch (error: any) {
          setLoading(false);
          setProcessingStatus('');
          toast({
            title: 'Extraction failed',
            description: error.message || 'Failed to extract data. Please try again.',
            variant: 'destructive',
          });
        }
      };

      reader.readAsDataURL(file);
    } catch (error: any) {
      setLoading(false);
      setProcessingStatus('');
      toast({
        title: 'Processing failed',
        description: error.message || 'Failed to process the file.',
        variant: 'destructive',
      });
    }
  };

  const handleProcess = async () => {
    if (!file) return;

    if (file.type === 'application/pdf') {
      await processPDF();
    } else {
      await processImage();
    }
  };

  const copyToClipboard = () => {
    if (results?.plainText) {
      navigator.clipboard.writeText(results.plainText);
      toast({
        title: 'Copied to clipboard',
        description: 'Text has been copied to your clipboard.',
      });
    }
  };

  const downloadAsText = () => {
    if (results?.plainText) {
      const blob = new Blob([results.plainText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extracted-text-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download started',
        description: 'Your text file is being downloaded.',
      });
    }
  };

  const getProcessingMethodBadge = () => {
    if (!results?.processingMethod) return null;

    const badges = {
      'text-extraction': { label: 'Text Extraction', variant: 'default' as const },
      'ocr': { label: 'Image OCR', variant: 'secondary' as const },
      'scanned-pdf-ocr': { label: 'Scanned PDF OCR', variant: 'secondary' as const },
    };

    const badge = badges[results.processingMethod];
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Data Extraction (OCR)
        </h2>
        <p className="text-gray-600">
          Extract text and structured data from images and PDFs (text-based or scanned)
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload Document</CardTitle>
            <CardDescription>
              Upload an image or PDF file to extract data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4 mb-4">
              <div className="space-y-2">
                <Label htmlFor="ocr-provider">OCR Provider</Label>
                <Select
                  value={ocrProvider}
                  onValueChange={(value: OCRProvider) => setOcrProvider(value)}
                  disabled={loading}
                >
                  <SelectTrigger id="ocr-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replicate">Replicate (datalab-to/ocr)</SelectItem>
                    <SelectItem value="openrouter">OpenRouter (GPT-4o / Claude)</SelectItem>
                    <SelectItem value="mistral">Mistral OCR (Best Quality)</SelectItem>
                    <SelectItem value="llamaparse">LlamaParse (Free Tier)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {ocrProvider === 'openrouter' && (
                <div className="space-y-2">
                  <Label htmlFor="ocr-model">Model</Label>
                  <Select
                    value={ocrModel}
                    onValueChange={(value: OCRModel) => setOcrModel(value)}
                    disabled={loading}
                  >
                    <SelectTrigger id="ocr-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai/gpt-4o">GPT-4o (Fast & Reliable)</SelectItem>
                      <SelectItem value="openai/gpt-4o-mini">GPT-4o Mini (Budget Friendly)</SelectItem>
                      <SelectItem value="openai/o1">o1 (Advanced Reasoning)</SelectItem>
                      <SelectItem value="anthropic/claude-sonnet-4">Claude Sonnet 4 (Balanced)</SelectItem>
                      <SelectItem value="anthropic/claude-opus-4">Claude Opus 4 (Most Capable)</SelectItem>
                      <SelectItem value="anthropic/claude-3.5-haiku-20241022">Claude 3.5 Haiku (Fast)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors">
              <input
                type="file"
                id="ocr-upload"
                className="hidden"
                accept="image/*,application/pdf"
                onChange={handleFileChange}
              />
              <label
                htmlFor="ocr-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-10 w-10 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-gray-500">PNG, JPG, or PDF (max 5MB)</p>
              </label>
            </div>

            {file && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                {file.type === 'application/pdf' ? (
                  <FileText className="h-5 w-5 text-gray-500" />
                ) : (
                  <FileImage className="h-5 w-5 text-gray-500" />
                )}
                <span className="text-sm text-gray-700 flex-1">{file.name}</span>
                <span className="text-xs text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            )}

            {loading && processingStatus && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-700">{processingStatus}</p>
              </div>
            )}

            <Button
              onClick={handleProcess}
              disabled={loading || !file}
              className="w-full bg-[#DB0011] hover:bg-[#B00010] text-white"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Extract Data
            </Button>
          </CardContent>
        </Card>

        {results && (
          <div className="space-y-4">
            {results.classification && (
              <Card className="border-l-4 border-l-[#DB0011]">
                <CardContent className="py-4 px-5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#DB0011]/10">
                      <Tag className="h-4.5 w-4.5 text-[#DB0011]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Document Classification</p>
                      <p className="text-lg font-semibold text-gray-900 mt-0.5">{results.classification.category}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        results.classification.confidence >= 0.8
                          ? 'border-green-300 bg-green-50 text-green-700'
                          : results.classification.confidence >= 0.6
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-gray-300 bg-gray-50 text-gray-600'
                      }
                    >
                      {Math.round(results.classification.confidence * 100)}% confidence
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Results</CardTitle>
                    <CardDescription>
                      {results.metadata && (
                        <span>
                          {results.metadata.numPages} page{results.metadata.numPages > 1 ? 's' : ''} • {(results.metadata.fileSize / 1024 / 1024).toFixed(2)} MB
                          {results.processingTime && ` • ${(results.processingTime / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {getProcessingMethodBadge()}
                    {results.provider && (
                      <Badge variant="outline" className="capitalize">
                        {results.provider}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={results.brDetails ? "business" : "text"} className="w-full">
                  <TabsList className={`grid w-full ${results.brDetails ? 'grid-cols-4' : 'grid-cols-3'}`}>
                    {results.brDetails && (
                      <TabsTrigger value="business">Business Details</TabsTrigger>
                    )}
                    <TabsTrigger value="text">Plain Text</TabsTrigger>
                    <TabsTrigger value="json">JSON Output</TabsTrigger>
                    <TabsTrigger value="visualization">Visualization</TabsTrigger>
                  </TabsList>

                  {results.brDetails && (
                    <TabsContent value="business" className="mt-4">
                      <div className="space-y-4">
                        {results.brDetails.companyName && (
                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <Building2 className="h-5 w-5 text-[#DB0011] mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Company Name</p>
                              <p className="text-base font-semibold text-gray-900 mt-0.5">{results.brDetails.companyName}</p>
                            </div>
                          </div>
                        )}

                        {results.brDetails.registrationNumber && (
                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <Hash className="h-5 w-5 text-[#DB0011] mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Registration Number</p>
                              <p className="text-base font-semibold text-gray-900 mt-0.5">{results.brDetails.registrationNumber}</p>
                            </div>
                          </div>
                        )}

                        {results.brDetails.address && (
                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <MapPin className="h-5 w-5 text-[#DB0011] mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Registered Address</p>
                              <p className="text-base text-gray-900 mt-0.5">{results.brDetails.address}</p>
                            </div>
                          </div>
                        )}

                        {results.brDetails.directors.length > 0 && (
                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <Users className="h-5 w-5 text-[#DB0011] mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Directors</p>
                              <ul className="mt-1.5 space-y-1">
                                {results.brDetails.directors.map((director: string, idx: number) => (
                                  <li key={idx} className="text-base text-gray-900 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-full bg-[#DB0011]/10 text-[#DB0011] text-xs font-medium flex items-center justify-center shrink-0">
                                      {idx + 1}
                                    </span>
                                    {director}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                          {results.brDetails.dateOfIncorporation && (
                            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                              <Calendar className="h-5 w-5 text-[#DB0011] mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date of Incorporation</p>
                                <p className="text-sm font-medium text-gray-900 mt-0.5">{results.brDetails.dateOfIncorporation}</p>
                              </div>
                            </div>
                          )}

                          {results.brDetails.businessNature && (
                            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                              <Briefcase className="h-5 w-5 text-[#DB0011] mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Nature of Business</p>
                                <p className="text-sm font-medium text-gray-900 mt-0.5">{results.brDetails.businessNature}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {!results.brDetails.companyName && !results.brDetails.address && results.brDetails.directors.length === 0 && (
                          <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                            <p className="text-sm text-gray-500">
                              Could not extract structured business details from this document.
                            </p>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  )}

                  <TabsContent value="text" className="mt-4">
                    <div className="space-y-4">
                      <div className="max-h-96 overflow-y-auto bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                          {results.plainText}
                        </pre>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={copyToClipboard}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy to Clipboard
                        </Button>
                        <Button
                          onClick={downloadAsText}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download as TXT
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="json" className="mt-4">
                    <div className="max-h-96 overflow-y-auto bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                        {JSON.stringify(results.jsonData, null, 2)}
                      </pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="visualization" className="mt-4">
                    {results.visualizationUrl ? (
                      <div className="rounded-lg overflow-hidden bg-gray-50 p-4 border border-gray-200">
                        <img
                          src={results.visualizationUrl}
                          alt="OCR Visualization"
                          className="w-full h-auto rounded-lg shadow-sm"
                        />
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="text-sm text-gray-500">
                          No visualization available for this processing method
                        </p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
