

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Loader as Loader2, Upload, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { extractTextFromPDF } from '@/lib/pdfUtils';
import ReactMarkdown from 'react-markdown';

const LANGUAGES = [
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Malay',
  'Tamil',
  'Hindi',
  'Thai',
  'French',
  'Spanish',
];

export function TranslationService() {
  const [textMode, setTextMode] = useState({
    input: '',
    output: '',
    targetLang: '',
    loading: false,
  });

  const [docMode, setDocMode] = useState({
    file: null as File | null,
    output: '',
    targetLang: '',
    loading: false,
  });

  const { toast } = useToast();

  const translateText = async () => {
    if (!textMode.input.trim() || !textMode.targetLang) return;

    setTextMode((prev) => ({ ...prev, loading: true, output: '' }));

    try {
      const apiUrl = `${supabaseUrl}/functions/v1/translate`;
      console.log('Translation request:', { apiUrl, targetLang: textMode.targetLang, textLength: textMode.input.length });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textMode.input,
          targetLang: textMode.targetLang,
        }),
      });

      console.log('Translation response:', { status: response.status, ok: response.ok });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Translation API error:', errorText);
        let errorMessage = 'Failed to get translation';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;

          if (errorMessage.includes('Key limit exceeded') || errorMessage.includes('limit')) {
            errorMessage = 'API key limit exceeded. Please update your OpenRouter API key in Settings.';
          }
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            if (json.content) {
              accumulatedText += json.content;
              setTextMode((prev) => ({ ...prev, output: accumulatedText }));
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }

      setTextMode((prev) => ({ ...prev, loading: false }));

      toast({
        title: 'Translation Complete',
        description: `Successfully translated to ${textMode.targetLang}`,
      });
    } catch (error: any) {
      console.error('Translation error:', error);
      setTextMode((prev) => ({ ...prev, loading: false }));

      toast({
        title: 'Translation Failed',
        description: error.message || 'Failed to translate text. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const translateDocument = async () => {
    if (!docMode.file || !docMode.targetLang) return;

    setDocMode((prev) => ({ ...prev, loading: true, output: '' }));

    toast({
      title: 'Processing document',
      description: 'Reading and translating your file...',
    });

    try {
      let text = '';
      const fileExtension = docMode.file.name.split('.').pop()?.toLowerCase();

      if (fileExtension === 'pdf') {
        text = await extractTextFromPDF(docMode.file);
      } else {
        text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(docMode.file!);
        });
      }

      if (!text || text.trim().length === 0) {
        throw new Error('File appears to be empty or could not be read');
      }

      console.log('Document text length:', text.length);
      console.log('Target language:', docMode.targetLang);

      const apiUrl = `${supabaseUrl}/functions/v1/translate`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          targetLang: docMode.targetLang,
        }),
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error:', errorText);
        let errorMessage = `Failed to get translation: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;

          if (errorMessage.includes('Key limit exceeded') || errorMessage.includes('limit')) {
            errorMessage = 'API key limit exceeded. Please update your OpenRouter API key in Settings.';
          }
        } catch (e) {
          // Keep default error message
        }
        throw new Error(errorMessage);
      }

      const streamReader = response.body?.getReader();
      if (!streamReader) {
        throw new Error('No reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            if (json.content) {
              accumulatedText += json.content;
              setDocMode((prev) => ({ ...prev, output: accumulatedText }));
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }

      setDocMode((prev) => ({ ...prev, loading: false }));

      toast({
        title: 'Translation Complete',
        description: `Successfully translated document to ${docMode.targetLang}`,
      });
    } catch (error: any) {
      console.error('Document translation error:', error);
      setDocMode((prev) => ({ ...prev, loading: false }));

      toast({
        title: 'Translation Failed',
        description: error.message || 'Failed to translate document. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: 'Please upload a file smaller than 10MB.',
          variant: 'destructive',
        });
        return;
      }

      const allowedTypes = ['text/plain', 'application/pdf', 'application/txt', 'text/markdown'];
      const fileExtension = file.name.split('.').pop()?.toLowerCase();

      if (!allowedTypes.includes(file.type) && fileExtension !== 'txt' && fileExtension !== 'md' && fileExtension !== 'pdf') {
        toast({
          title: 'Unsupported file type',
          description: 'Please upload a PDF or text file (.pdf, .txt, or .md).',
          variant: 'destructive',
        });
        return;
      }

      setDocMode((prev) => ({ ...prev, file, output: '' }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Translation Service</h2>
        <p className="text-gray-600">Translate text or documents to multiple languages</p>
      </div>

      <Tabs defaultValue="text" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="text">Text Translation</TabsTrigger>
          <TabsTrigger value="document">Document Translation</TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Text Translation</CardTitle>
              <CardDescription>
                Enter text and select your target language
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Input Text</label>
                <Textarea
                  placeholder="Enter text to translate..."
                  value={textMode.input}
                  onChange={(e) =>
                    setTextMode((prev) => ({ ...prev, input: e.target.value }))
                  }
                  rows={6}
                  className="resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Target Language</label>
                <Select
                  value={textMode.targetLang}
                  onValueChange={(value) =>
                    setTextMode((prev) => ({ ...prev, targetLang: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target language" />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={translateText}
                disabled={textMode.loading || !textMode.input.trim() || !textMode.targetLang}
                className="w-full bg-[#DB0011] hover:bg-[#B00010] text-white"
              >
                {textMode.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Translate
              </Button>
            </CardContent>
          </Card>

          {textMode.output && (
            <Card className="border-l-4 border-l-[#DB0011]">
              <CardHeader>
                <CardTitle className="text-lg">Translated Text</CardTitle>
                <CardDescription>Output in {textMode.targetLang}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-ul:text-gray-700 prose-ol:text-gray-700 prose-code:text-gray-900 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded max-w-none">
                  <ReactMarkdown>{textMode.output}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="document" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Document Translation</CardTitle>
              <CardDescription>
                Upload a PDF or text file for translation (max 10MB)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors">
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf,.txt,.md,application/pdf,text/plain"
                  onChange={handleFileChange}
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="h-10 w-10 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PDF, TXT or MD files (max 10MB)</p>
                </label>
              </div>

              {docMode.file && (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <FileText className="h-5 w-5 text-gray-500" />
                  <span className="text-sm text-gray-700 flex-1">{docMode.file.name}</span>
                  <span className="text-xs text-gray-500">
                    {(docMode.file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Target Language</label>
                <Select
                  value={docMode.targetLang}
                  onValueChange={(value) =>
                    setDocMode((prev) => ({ ...prev, targetLang: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target language" />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={translateDocument}
                disabled={docMode.loading || !docMode.file || !docMode.targetLang}
                className="w-full bg-[#DB0011] hover:bg-[#B00010] text-white"
              >
                {docMode.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Translate Document
              </Button>
            </CardContent>
          </Card>

          {docMode.output && (
            <Card className="border-l-4 border-l-[#DB0011]">
              <CardHeader>
                <CardTitle className="text-lg">Translated Document</CardTitle>
                <CardDescription>Output in {docMode.targetLang}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-ul:text-gray-700 prose-ol:text-gray-700 prose-code:text-gray-900 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded max-w-none">
                  <ReactMarkdown>{docMode.output}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
