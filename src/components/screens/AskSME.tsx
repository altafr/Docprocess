

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MARKETS, JOURNEYS } from '@/lib/constants';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'sme';
  timestamp: string;
}

export function AskSME() {
  const [step, setStep] = useState<'select' | 'chat'>('select');
  const [market, setMarket] = useState('');
  const [journey, setJourney] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startChat = () => {
    if (market && journey) {
      setStep('chat');
      setMessages([
        {
          id: '1',
          text: `Connecting you to a ${journey} SME in ${market}...`,
          sender: 'sme',
          timestamp: new Date().toLocaleTimeString(),
        },
        {
          id: '2',
          text: `Hello! I'm the ${journey} subject matter expert for ${market}. How can I assist you today?`,
          sender: 'sme',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    const smeMessageId = (Date.now() + 1).toString();
    const smeMessage: Message = {
      id: smeMessageId,
      text: '',
      sender: 'sme',
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, smeMessage]);

    try {
      const apiUrl = `${supabaseUrl}/functions/v1/asksme`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: currentInput,
          expertArea: `${market} - ${journey}`,
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
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === smeMessageId
                    ? { ...msg, text: accumulatedText }
                    : msg
                )
              );
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    } catch (error: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === smeMessageId
            ? { ...msg, text: `Sorry, I encountered an error: ${error.message}. Please try again.` }
            : msg
        )
      );
    } finally {
      setLoading(false);
    }
  };

  if (step === 'select') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">AskSME</h2>
          <p className="text-gray-600">Connect with subject matter experts</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Select Market & Journey</CardTitle>
            <CardDescription>
              Choose your market and area of inquiry to connect with the right expert
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <Button
              onClick={startChat}
              disabled={!market || !journey}
              className="w-full bg-[#DB0011] hover:bg-[#B00010] text-white"
            >
              Connect with SME
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            {journey} Expert - {market}
          </h2>
          <p className="text-gray-600">Chat with your assigned SME</p>
        </div>
        <Button variant="outline" onClick={() => setStep('select')}>
          Change Selection
        </Button>
      </div>

      <Card className="h-[500px] flex flex-col">
        <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-3',
                message.sender === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {message.sender === 'sme' && (
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-[#DB0011] text-white text-xs">
                    SME
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  'max-w-[70%] rounded-lg px-4 py-2',
                  message.sender === 'user'
                    ? 'bg-[#DB0011] text-white'
                    : 'bg-gray-100 text-gray-900'
                )}
              >
                {message.sender === 'user' ? (
                  <p className="text-sm">{message.text}</p>
                ) : (
                  <div className="prose prose-sm prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-ul:text-gray-700 prose-ol:text-gray-700 prose-code:text-gray-900 prose-code:bg-gray-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded max-w-none text-sm">
                    <ReactMarkdown>{message.text}</ReactMarkdown>
                  </div>
                )}
                <span
                  className={cn(
                    'text-xs mt-1 block',
                    message.sender === 'user' ? 'text-red-100' : 'text-gray-500'
                  )}
                >
                  {message.timestamp}
                </span>
              </div>
              {message.sender === 'user' && (
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-gray-300 text-gray-700 text-xs">
                    You
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="bg-[#DB0011] hover:bg-[#B00010] text-white"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
