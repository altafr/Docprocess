

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Eye, EyeOff, Save, Check } from 'lucide-react';

export function Settings() {
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [replicateToken, setReplicateToken] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseServiceKey, setSupabaseServiceKey] = useState('');
  const [mistralKey, setMistralKey] = useState('');
  const [llamaParseKey, setLlamaParseKey] = useState('');
  const [showOpenRouter, setShowOpenRouter] = useState(false);
  const [showReplicate, setShowReplicate] = useState(false);
  const [showMistral, setShowMistral] = useState(false);
  const [showLlamaParse, setShowLlamaParse] = useState(false);
  const [showSupabaseAnon, setShowSupabaseAnon] = useState(false);
  const [showSupabaseService, setShowSupabaseService] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const settings: Record<string, string> = {};

      if (openRouterKey) settings.OPENROUTER_API_KEY = openRouterKey;
      if (llmModel) settings.LLM_MODEL = llmModel;
      if (replicateToken) settings.REPLICATE_API_TOKEN = replicateToken;
      if (mistralKey) settings.MISTRAL_API_KEY = mistralKey;
      if (llamaParseKey) settings.LLAMAPARSE_API_KEY = llamaParseKey;
      if (supabaseUrl) settings.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
      if (supabaseAnonKey) settings.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseAnonKey;
      if (supabaseServiceKey) settings.SUPABASE_SERVICE_ROLE_KEY = supabaseServiceKey;

      const { callEdgeFunction } = await import('@/lib/supabase');
      await callEdgeFunction('settings', settings);

      setMessage({ type: 'success', text: 'Settings saved successfully! Please refresh the page for changes to take effect.' });
      setOpenRouterKey('');
      setLlmModel('');
      setReplicateToken('');
      setMistralKey('');
      setLlamaParseKey('');
      setSupabaseUrl('');
      setSupabaseAnonKey('');
      setSupabaseServiceKey('');
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">API Settings</h1>
        <p className="text-gray-600 mt-2">
          Configure your API keys for OpenRouter and Replicate services. These keys are stored securely in the database.
        </p>
      </div>

      {message && (
        <Alert className={message.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}>
          <AlertDescription className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
            {message.text}
          </AlertDescription>
        </Alert>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>OpenRouter API Key</CardTitle>
          <CardDescription>
            Required for AI-powered features (Procedure Q&A, AskSME, Translation Service)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openrouter">API Key</Label>
              <div className="relative">
                <Input
                  id="openrouter"
                  type={showOpenRouter ? 'text' : 'password'}
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenRouter(!showOpenRouter)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showOpenRouter ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-sm text-gray-500">
                Get your API key from{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#DB0011] hover:underline"
                >
                  OpenRouter
                </a>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="llmModel">LLM Model</Label>
              <Input
                id="llmModel"
                type="text"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder="anthropic/claude-3.5-sonnet"
              />
              <p className="text-sm text-gray-500">
                Specify the OpenRouter model to use (e.g., anthropic/claude-3.5-sonnet, openai/gpt-4)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Replicate API Token</CardTitle>
          <CardDescription>
            Required for OCR and document processing features (Data Extraction)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="replicate">API Token</Label>
            <div className="relative">
              <Input
                id="replicate"
                type={showReplicate ? 'text' : 'password'}
                value={replicateToken}
                onChange={(e) => setReplicateToken(e.target.value)}
                placeholder="r8_..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowReplicate(!showReplicate)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showReplicate ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Get your API token from{' '}
              <a
                href="https://replicate.com/account/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#DB0011] hover:underline"
              >
                Replicate
              </a>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Mistral API Key</CardTitle>
          <CardDescription>
            Required for Mistral OCR -- state-of-the-art document text extraction
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="mistral">API Key</Label>
            <div className="relative">
              <Input
                id="mistral"
                type={showMistral ? 'text' : 'password'}
                value={mistralKey}
                onChange={(e) => setMistralKey(e.target.value)}
                placeholder="..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowMistral(!showMistral)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showMistral ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Get your API key from{' '}
              <a
                href="https://console.mistral.ai/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#DB0011] hover:underline"
              >
                Mistral AI Console
              </a>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>LlamaParse API Key</CardTitle>
          <CardDescription>
            Required for LlamaParse -- 1,000 free pages/month for document parsing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="llamaparse">API Key</Label>
            <div className="relative">
              <Input
                id="llamaparse"
                type={showLlamaParse ? 'text' : 'password'}
                value={llamaParseKey}
                onChange={(e) => setLlamaParseKey(e.target.value)}
                placeholder="llx-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowLlamaParse(!showLlamaParse)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showLlamaParse ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Get your API key from{' '}
              <a
                href="https://cloud.llamaindex.ai/api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#DB0011] hover:underline"
              >
                LlamaCloud
              </a>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || (!openRouterKey && !llmModel && !replicateToken && !mistralKey && !llamaParseKey)}
          className="bg-[#DB0011] hover:bg-[#B00010]"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
