

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader as Loader2 } from 'lucide-react';
import { MARKETS, JOURNEYS } from '@/lib/constants';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import ReactMarkdown from 'react-markdown';

export function ProcedureQA() {
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('');
  const [journey, setJourney] = useState('');
  const [response, setResponse] = useState<{ text: string; timestamp: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setResponse({ text: '', timestamp: new Date().toLocaleString() });

    try {
      const apiUrl = `${supabaseUrl}/functions/v1/procedure-qa`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: query,
          market: market,
          journey: journey,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        let errorMessage = 'Failed to get response';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
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
              setResponse({
                text: accumulatedText,
                timestamp: new Date().toLocaleString(),
              });
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    } catch (error: any) {
      setResponse({
        text: `Error: ${error.message}. Please try again.`,
        timestamp: new Date().toLocaleString(),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Procedure Q&A</h2>
        <p className="text-gray-600">Ask about any procedure or policy</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit Your Query</CardTitle>
          <CardDescription>
            Get instant answers about Commercial Banking procedures
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Market</label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger>
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Journey</label>
              <Select value={journey} onValueChange={setJourney}>
                <SelectTrigger>
                  <SelectValue placeholder="Select journey" />
                </SelectTrigger>
                <SelectContent>
                  {JOURNEYS.map((j) => (
                    <SelectItem key={j} value={j}>
                      {j}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            placeholder="e.g., What are the KYC requirements for opening a commercial account?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <Button
            onClick={handleSubmit}
            disabled={loading || !query.trim() || !market || !journey}
            className="bg-[#DB0011] hover:bg-[#B00010] text-white"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Search Procedures
          </Button>
        </CardContent>
      </Card>

      {response && (
        <Card className="border-l-4 border-l-[#DB0011]">
          <CardHeader>
            <div className="flex items-start justify-between">
              <CardTitle className="text-lg">Response</CardTitle>
              <span className="text-xs text-gray-500">{response.timestamp}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-ul:text-gray-700 prose-ol:text-gray-700 prose-code:text-gray-900 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded max-w-none">
              <ReactMarkdown>{response.text}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
