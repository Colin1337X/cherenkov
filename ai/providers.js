(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XenonProviders = api;
})(globalThis, function () {
  'use strict';
  function requestBody(profile, messages, params = {}, stream = true) {
    const caps = profile.capabilities || {};
    const body = { model: profile.model, messages, stream };
    for (const name of ['temperature', 'top_p', 'presence_penalty', 'reasoning_effort']) {
      if (caps[name] !== false && params[name] !== undefined) body[name] = params[name];
    }
    if (params.max_tokens !== undefined) body[caps.tokenField === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens'] = params.max_tokens;
    if (stream && caps.usage !== false) body.stream_options = { include_usage: true };
    return body;
  }
  function reasoning(part) {
    const v = part?.reasoning_content ?? part?.reasoning ?? part?.thinking;
    return typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => x.text || x.content || '').join('') : v?.content || '';
  }
  async function parse(response, onUpdate, signal) {
    let content = '', thoughts = '', usage;
    const emit = () => onUpdate?.({ content, reasoning: thoughts, usage });
    signal?.throwIfAborted();
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const json = await response.json();
      signal?.throwIfAborted();
      if (json.error) throw new Error(json.error.message || 'Provider error.');
      content = json.choices?.[0]?.message?.content || '';
      thoughts = reasoning(json.choices?.[0]?.message); usage = json.usage; emit();
    } else {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', finished = false, eventLines = [];
      function dispatch() {
        const data = eventLines.join('\n').trim(); eventLines = [];
        if (!data) return;
        if (data === '[DONE]') { finished = true; return; }
        const event = JSON.parse(data);
        if (event.error) throw new Error(event.error.message || 'Provider error.');
        const choice = event.choices?.[0];
        content += choice?.delta?.content || choice?.text || '';
        thoughts += reasoning(choice?.delta);
        usage = event.usage || usage;
        emit();
      }
      function line(text) {
        if (!text) return dispatch();
        if (text.startsWith('data:')) eventLines.push(text.slice(5).replace(/^ /, ''));
      }
      const abort = () => { reader.cancel(signal.reason).catch(() => {}); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        while (!finished) {
          signal?.throwIfAborted();
          const { value, done } = await reader.read();
          signal?.throwIfAborted();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/); buffer = lines.pop();
          for (const text of lines) { line(text); if (finished) break; }
          if (buffer.length > 2_000_000) throw new Error('Provider event is too large.');
          if (done) { if (buffer.trim()) line(buffer); if (!finished) dispatch(); break; }
        }
      } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    if (typeof content !== 'string' || !content.trim()) throw new Error('Provider returned no manuscript text.');
    return { content, reasoning: thoughts, usage };
  }
  async function complete({ profile, messages, params, signal, onUpdate, fetchImpl = fetch, timeout = 120000, retries = 0 }) {
    if ((!profile.proxy && !profile.endpoint) || !profile.model) throw new Error('Configure an endpoint and model first.');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Request timed out.')), Math.max(100, Math.min(Number(timeout) || 120000, 900000)));
    const started = performance.now();
    try {
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted();
        const url = profile.proxy ? '/api/inference' : profile.endpoint.replace(/\/$/, '') + '/chat/completions';
        let response;
        try {
          response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json',
            ...(profile.proxy ? {} : profile.apiKey ? { Authorization: 'Bearer ' + profile.apiKey } : {}) },
          body: JSON.stringify(profile.proxy ? { profile: profile.serverProfile || 'default', body: requestBody(profile, messages, params) } : requestBody(profile, messages, params)) });
        } catch (error) { if (!controller.signal.aborted && attempt < Math.min(3, retries)) continue; throw error; }
        if (!response.ok) {
          // Do not echo upstream bodies: some providers include request headers or credentials.
          await response.body?.cancel();
          if ((response.status === 429 || response.status >= 500) && attempt < Math.min(3, retries)) continue;
          throw new Error(`Inference HTTP ${response.status}. Check endpoint, model, credentials, and provider capabilities.`);
        }
        // Never retry a partly consumed stream: this would mix candidate drafts.
        const result = await parse(response, onUpdate, controller.signal);
        controller.signal.throwIfAborted();
        const seconds = Math.max(.001, (performance.now() - started) / 1000);
        const tokens = result.usage?.completion_tokens || Math.ceil((result.content.length + result.reasoning.length) / 4);
        return { ...result, metrics: { completionTokens: tokens, elapsedSeconds: seconds, tokensPerSecond: tokens / seconds } };
      }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return { requestBody, reasoning, parse, complete };
});
