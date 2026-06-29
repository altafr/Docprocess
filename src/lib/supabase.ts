import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://zgrghavfcqilbzgyflhs.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpncmdoYXZmY3FpbGJ6Z3lmbGhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NzMyMDAsImV4cCI6MjA3ODI0OTIwMH0.NCNGnbaZL8ljqNU68rFhG6shpu9WAcwKF2HXmTHmqjo';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export { supabaseUrl, supabaseAnonKey };

export async function callEdgeFunction(functionName: string, body: any) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });

  if (error) {
    throw new Error(error.message || 'Edge function call failed');
  }

  if (data && data.error) {
    throw new Error(data.error);
  }

  return data;
}

// Returns a raw fetch Response with a streaming body (text/event-stream).
export async function streamEdgeFunction(functionName: string, body: any): Promise<Response> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Apikey': supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Edge function ${functionName} error ${response.status}: ${text}`);
  }
  return response;
}
