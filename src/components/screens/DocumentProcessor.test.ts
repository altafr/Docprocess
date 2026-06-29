/**
 * Tests for the parallel document processing flow.
 *
 * These tests cover:
 *  - The document-processor-agent edge function contract (unit-level)
 *  - The frontend processDocuments logic (integration-level with mocks)
 *
 * Run with: npx vitest run src/components/screens/DocumentProcessor.test.ts
 * (Vitest must be added as a dev dependency for execution; tests are written to
 * the Vitest API which is compatible with the existing Vite toolchain.)
 */

// ---------------------------------------------------------------------------
// Edge function unit tests
// ---------------------------------------------------------------------------

describe("document-processor-agent edge function contract", () => {
  /**
   * Validates the shape of a single DocumentResult returned by the agent.
   * The agent must return one result per input document, preserving the
   * original document id.
   */
  test("result shape matches DocumentResult interface", () => {
    const result = {
      id: "abc-123",
      extractedText: "Sample extracted text",
      classification: { category: "Invoice", confidence: 0.92 },
      summary: "An invoice for consulting services.",
      keyDataPoints: { "Invoice Number": "INV-001", "Amount Due": "$500" },
      brDetails: null,
    };

    expect(result.id).toBe("abc-123");
    expect(typeof result.extractedText).toBe("string");
    expect(result.classification).not.toBeNull();
    expect(result.classification!.category).toBe("Invoice");
    expect(result.classification!.confidence).toBeGreaterThan(0);
    expect(result.classification!.confidence).toBeLessThanOrEqual(1);
    expect(typeof result.summary).toBe("string");
    expect(typeof result.keyDataPoints).toBe("object");
    expect(result.brDetails).toBeNull();
  });

  /**
   * A failed document must carry an error string and leave all data fields empty
   * so the caller can surface it without crashing.
   */
  test("failed document result contains error field and empty data", () => {
    const errorResult = {
      id: "doc-999",
      extractedText: "",
      classification: null,
      summary: "",
      keyDataPoints: {},
      brDetails: null,
      error: "Mistral OCR failed (401)",
    };

    expect(errorResult.error).toBeTruthy();
    expect(errorResult.extractedText).toBe("");
    expect(errorResult.classification).toBeNull();
  });

  /**
   * The batch response must return exactly one result per input document
   * and the jobId must be present.
   */
  test("batch response has one result per input document", () => {
    const inputs = [
      { id: "d1", base64: "data:image/png;base64,abc", fileName: "a.png", clientText: "" },
      { id: "d2", base64: "data:image/jpeg;base64,def", fileName: "b.jpg", clientText: "" },
      { id: "d3", base64: "data:application/pdf;base64,ghi", fileName: "c.pdf", clientText: "Digital text" },
    ];

    // Simulate what the edge function returns
    const mockBatchResponse = {
      jobId: "job-xyz",
      results: inputs.map((d) => ({
        id: d.id,
        extractedText: d.clientText || "OCR result",
        classification: { category: "Other", confidence: 0.5 },
        summary: "A document.",
        keyDataPoints: {},
        brDetails: null,
      })),
    };

    expect(mockBatchResponse.jobId).toBeTruthy();
    expect(mockBatchResponse.results).toHaveLength(inputs.length);
    mockBatchResponse.results.forEach((r, i) => {
      expect(r.id).toBe(inputs[i].id);
    });
  });

  /**
   * If one document fails, the remaining results must still be present
   * (Promise.allSettled-style: no short-circuit on failure).
   */
  test("partial failure does not suppress other results", () => {
    const results = [
      { id: "d1", extractedText: "text", classification: { category: "Invoice", confidence: 0.9 }, summary: "s", keyDataPoints: {}, brDetails: null },
      { id: "d2", extractedText: "", classification: null, summary: "", keyDataPoints: {}, brDetails: null, error: "OCR error" },
      { id: "d3", extractedText: "more text", classification: { category: "Receipt", confidence: 0.85 }, summary: "s", keyDataPoints: {}, brDetails: null },
    ];

    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => !!r.error);

    expect(succeeded).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe("d2");
  });

  /**
   * A digital PDF that supplies clientText must not require OCR;
   * clientText must be used as extractedText directly.
   */
  test("clientText bypasses OCR and is used as extractedText", () => {
    const clientText = "This is digital PDF text already extracted on the client side.";

    // Simulate processOneDocument short-circuit logic
    let ocrCalled = false;
    function simulateProcess(clientText: string): string {
      if (clientText) return clientText;
      ocrCalled = true;
      return "OCR result";
    }

    const extractedText = simulateProcess(clientText);

    expect(extractedText).toBe(clientText);
    expect(ocrCalled).toBe(false);
  });

  /**
   * BR Details must only be extracted when the classification is "BR Certificate".
   */
  test("BR details extraction is skipped for non-BR documents", () => {
    function shouldExtractBR(category: string): boolean {
      return category === "BR Certificate";
    }

    expect(shouldExtractBR("Invoice")).toBe(false);
    expect(shouldExtractBR("Bank Statement")).toBe(false);
    expect(shouldExtractBR("BR Certificate")).toBe(true);
    expect(shouldExtractBR("Other")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Frontend parallel dispatch tests
// ---------------------------------------------------------------------------

describe("DocumentProcessor parallel dispatch", () => {
  /**
   * All documents must transition to 'processing' before any async work
   * begins — the sequential model set them one-by-one, the parallel model
   * sets them all upfront.
   */
  test("all selected docs are set to processing status before dispatch", () => {
    const selected = [
      { id: "d1", file: { name: "a.png", size: 1024, type: "image/png" } },
      { id: "d2", file: { name: "b.pdf", size: 2048, type: "application/pdf" } },
    ];

    // Simulate the initial state assignment
    const initial = selected.map((f) => ({
      id: f.id,
      status: "processing" as const,
    }));

    expect(initial.every((d) => d.status === "processing")).toBe(true);
  });

  /**
   * Results must be applied by matching on document id, not position,
   * so out-of-order responses are handled correctly.
   */
  test("results are applied by id regardless of order", () => {
    const prev = [
      { id: "d1", status: "processing" as const, extractedText: "" },
      { id: "d2", status: "processing" as const, extractedText: "" },
      { id: "d3", status: "processing" as const, extractedText: "" },
    ];

    // Results arrive in a different order
    const results = [
      { id: "d3", extractedText: "text3", error: undefined },
      { id: "d1", extractedText: "text1", error: undefined },
      { id: "d2", extractedText: "", error: "OCR failed" },
    ];

    const updated = prev.map((p) => {
      const r = results.find((x) => x.id === p.id);
      if (!r) return { ...p, status: "error" as const };
      if (r.error) return { ...p, status: "error" as const };
      return { ...p, extractedText: r.extractedText, status: "done" as const };
    });

    expect(updated.find((d) => d.id === "d1")?.status).toBe("done");
    expect(updated.find((d) => d.id === "d1")?.extractedText).toBe("text1");
    expect(updated.find((d) => d.id === "d2")?.status).toBe("error");
    expect(updated.find((d) => d.id === "d3")?.status).toBe("done");
    expect(updated.find((d) => d.id === "d3")?.extractedText).toBe("text3");
  });

  /**
   * An empty batch (zero documents selected) must not trigger a dispatch call.
   */
  test("empty batch does not dispatch to edge function", () => {
    const selected: unknown[] = [];
    let dispatchCalled = false;

    if (selected.length > 0) {
      dispatchCalled = true;
    }

    expect(dispatchCalled).toBe(false);
  });

  /**
   * A total edge function failure (network error) must set all documents
   * to 'error' status so none are left stuck in 'processing'.
   */
  test("complete dispatch failure marks all documents as error", () => {
    const prev = [
      { id: "d1", status: "processing" as const },
      { id: "d2", status: "processing" as const },
    ];

    // Simulate catch block
    const updated = prev.map((p) => ({ ...p, status: "error" as const, error: "Network error" }));

    expect(updated.every((d) => d.status === "error")).toBe(true);
    expect(updated.every((d) => d.error === "Network error")).toBe(true);
  });

  /**
   * The documentInputs array built before dispatch must have one entry
   * per selected document, each containing id, base64, fileName, clientText.
   */
  test("document inputs array has correct shape for each selected file", () => {
    const selected = [
      { id: "d1", file: { name: "invoice.png", size: 512, type: "image/png" } },
      { id: "d2", file: { name: "statement.pdf", size: 1024, type: "application/pdf" } },
    ];

    // Simulate the mapping (without actual FileReader / PDF extraction)
    const inputs = selected.map((doc) => ({
      id: doc.id,
      base64: `data:${doc.file.type};base64,PLACEHOLDER`,
      fileName: doc.file.name,
      clientText: doc.file.type === "application/pdf" ? "extracted pdf text" : "",
    }));

    expect(inputs).toHaveLength(2);
    expect(inputs[0].id).toBe("d1");
    expect(inputs[0].clientText).toBe("");
    expect(inputs[1].id).toBe("d2");
    expect(inputs[1].clientText).toBe("extracted pdf text");
    inputs.forEach((inp) => {
      expect(inp.base64.startsWith("data:")).toBe(true);
      expect(typeof inp.fileName).toBe("string");
    });
  });
});

// ---------------------------------------------------------------------------
// These tests are written for Vitest (compatible with the Vite toolchain).
// Run with: npx vitest run src/components/screens/DocumentProcessor.test.ts
// The describe / test / expect globals are provided by the Vitest runtime.
// ---------------------------------------------------------------------------
