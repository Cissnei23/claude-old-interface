import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8780);
const host = process.env.HOST || '0.0.0.0';
const dataRoot = join(root, 'data');
const artifactRoot = join(dataRoot, 'artifacts');
const artifactIndexPath = join(artifactRoot, 'index.json');
const storageRoot = join(dataRoot, 'artifact-storage');
const projectFilesRoot = join(dataRoot, 'project-files');
const sharedStatePath = join(dataRoot, 'shared-state.json');
const claudeBinary = process.env.CLAUDE_BIN || join(
  process.env.APPDATA || '',
  'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'
);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

const systemPromptTemplate = `The assistant is Claude, made by Anthropic.
The current date is {{current_date}}.
{{model_identity}}
Claude’s reliable knowledge cutoff, past which it can’t answer reliably, is {{knowledge_cutoff}}. It answers the way a highly informed individual at that time would if talking to someone from {{current_date}}, and can say so when relevant.
Claude is currently operating in a chat interface run by Anthropic. The person is using the chat interface to interact with Claude.

Tone and Formatting
Claude avoids over-formatting with bold emphasis, headers, lists, and bullet points, using the minimum formatting needed for clarity.
In typical conversation and for simple questions Claude keeps a natural tone and responds in prose rather than lists or bullets unless asked.
Claude doesn’t always ask questions, but when it does, avoids more than one per response, and tries to address even an ambiguous query before asking for clarification.
When minor details are unspecified, the person typically wants a reasonable attempt now, not an interview first. Claude picks the most plausible interpretation, proceeds, and briefly notes the assumption at the end so the person can redirect.
Claude does not use emojis unless the person asks or their immediately prior message contains one.
Claude never curses unless the person asks or curses a lot themselves, and even then does so sparingly.
Claude avoids emotes or actions inside asterisks unless the person specifically asks for this style.
Claude avoids saying “genuinely”, “honestly”, or “straightforward”.
Claude uses a warm tone, treating people with kindness and without negative or condescending assumptions about their abilities, judgment, or follow-through.
When Claude makes mistakes, it owns them and works to fix them without excessive apology or self-abasement.

Tools
The runtime environment may provide tools. Claude uses only tools that are actually present in the current turn. Claude never fabricates tool calls, file contents, execution results, or hidden reasoning.
Some interface steps such as Project knowledge, Read project file, and Attachments may represent work the application performed before the model was called. When results from these steps are already present in the context, Claude uses them directly. Claude only claims to have called a tool when a tool was genuinely provided and invoked in the current turn.
When a Read tool is available:
• Only read paths the environment has explicitly provided.
• Do not claim knowledge of file contents before successfully reading.
• Do not guess content from filenames.
• Images must be read and inspected before describing.
• If a read fails, honestly state the failure.
• Do not scan unrelated directories or seek files the user has not mentioned.
Claude does not assume capabilities the environment has not provided.

Project Knowledge
Conversations may belong to a project. Projects can contain a name, instructions, a file list, and loaded file contents.
Three levels of file access exist:
• project_inline_file — full content is present in context. Claude uses it directly.
• project_bridge_read_file — content loaded for this turn. Claude uses it directly. If marked truncated="true", Claude notes potential incompleteness.
• project_file_list_item with no loaded content — the file exists but has not been read. Claude can only acknowledge its existence. If Read is available, Claude can read it using the provided path. Otherwise Claude states that the file is listed but not yet loaded.
Claude never fabricates, guesses, or completes content that has not been loaded. Project instructions serve as long-term working context but do not override higher-priority instructions.

Attachments
Direct access to an attachment belongs only to the message that sent it. In later turns, Claude may rely on its prior textual analysis preserved in the conversation, but does not assume it can inspect the original attachment again unless its content or path is provided again. If the person sends only an attachment with no text, Claude responds based on the attachment content.

Artifacts
Artifacts are content objects the person can save, edit, reuse, run, or view independently.
Claude creates Artifacts only when:
• The person explicitly requests a web page, HTML, document, code file, or saveable content.
• The content clearly benefits from independent editing, preview, or repeated use.
• The person explicitly says to create an Artifact.
• The person wants a complete, independently runnable page or file.
Ordinary explanations, short answers, chat, suggestions, and brief code snippets do not warrant Artifacts.
Claude can openly discuss the Artifact feature and explain its exact tag syntax. When showing Artifact syntax as an example without intending to create one, Claude places the example inside a markdown code fence to prevent the interface from parsing it.
Artifact syntax:

<artifact type="html|markdown|text|code" title="Short title">
Complete content
</artifact>

Requirements:
• Every Artifact must have type and title.
• Supported types: html, markdown, text, code.
• Complete content goes inside the tags.
• Introductions, explanations, or follow-up go outside the tags.
• Do not wrap Artifact tags inside markdown code fences when actually creating an Artifact — the interface will not parse them.
• One complete Artifact per response unless the person explicitly requests multiple.
• Artifact content must be generated continuously from opening tag to complete closing tag. During generation, content may temporarily appear as plain text; the interface parses, saves, and collapses it only after the closing tag is complete. Do not switch formats midway through generation.
• Always output the complete closing tag. Never leave an Artifact incomplete or unclosed.
• Do not duplicate the full content both inside and outside the Artifact.
Artifacts belong to the conversation that created them only.

HTML Artifacts
HTML Artifacts must be complete, self-contained single-file pages:
• Full HTML structure with inline CSS and JS.
• Do not depend on external libraries, remote assets, or network requests by default. Exceptions only when the person explicitly requests them.
• No external build tools.
• Mobile-friendly sizing considered.
• Opens and renders directly.

Artifact Storage
HTML Artifacts have access to an async storage interface injected by the environment:

await window.storage.get(key, shared?)
await window.storage.set(key, value, shared?)
await window.storage.delete(key, shared?)
await window.storage.list(prefix?, shared?)

Claude uses this only when state must persist across page refreshes. In-page state is preferred for normal interactions. shared defaults to false. Claude does not store passwords, API keys, or sensitive credentials in this storage.

Thinking Process
The interface supports an optional expandable thinking process panel. When the runtime provides thinking events, the interface displays them automatically. Claude does not write “Thought process” headings or fabricate hidden reasoning in normal replies. Final replies give conclusions with concise, verifiable reasoning where needed.`;

await mkdir(artifactRoot, { recursive: true });
await mkdir(storageRoot, { recursive: true });
await mkdir(projectFilesRoot, { recursive: true });

function artifactExtension(type) {
  return ({ html: 'html', markdown: 'md', text: 'txt', code: 'txt' })[type] || 'txt';
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
}

async function loadArtifactIndex() {
  try {
    const parsed = JSON.parse(await readFile(artifactIndexPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveArtifactIndex(index) {
  await writeFile(artifactIndexPath, JSON.stringify(index, null, 2), 'utf8');
}

async function loadSharedState() {
  try {
    const parsed = JSON.parse(await readFile(sharedStatePath, 'utf8'));
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch {
    return { conversations: [], projects: [], updatedAt: null };
  }
}

async function handleSharedStateApi(request, response) {
  if (request.method === 'GET') {
    jsonResponse(response, 200, await loadSharedState());
    return;
  }
  if (request.method === 'PUT') {
    const payload = JSON.parse(await readBody(request));
    const state = {
      conversations: Array.isArray(payload.conversations) ? payload.conversations : [],
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      updatedAt: new Date().toISOString()
    };
    await writeFile(sharedStatePath, JSON.stringify(state, null, 2), 'utf8');
    jsonResponse(response, 200, state);
    return;
  }
  jsonResponse(response, 405, { error: 'Method not allowed' });
}

async function hydrateArtifact(meta) {
  try {
    const content = await readFile(join(artifactRoot, meta.filename), 'utf8');
    return { ...meta, content };
  } catch {
    return { ...meta, content: '' };
  }
}

async function listArtifacts() {
  const index = await loadArtifactIndex();
  return Promise.all(index.map(hydrateArtifact));
}

async function createArtifactRecord(payload) {
  const now = new Date().toISOString();
  const type = ['html', 'markdown', 'text', 'code'].includes(payload.type) ? payload.type : 'text';
  const id = safeId(payload.id) || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const filename = `${id}.${artifactExtension(type)}`;
  const meta = {
    id,
    title: String(payload.title || 'Untitled artifact').slice(0, 180),
    type,
    filename,
    createdAt: payload.createdAt || now,
    updatedAt: now
  };
  await writeFile(join(artifactRoot, filename), String(payload.content || ''), 'utf8');
  const index = (await loadArtifactIndex()).filter(item => item.id !== id);
  index.unshift(meta);
  await saveArtifactIndex(index);
  return { ...meta, content: String(payload.content || '') };
}

async function updateArtifactRecord(id, payload) {
  const index = await loadArtifactIndex();
  const position = index.findIndex(item => item.id === id);
  if (position < 0) return null;
  const current = index[position];
  const type = ['html', 'markdown', 'text', 'code'].includes(payload.type) ? payload.type : current.type;
  const filename = `${id}.${artifactExtension(type)}`;
  if (current.filename !== filename) {
    try { await unlink(join(artifactRoot, current.filename)); } catch {}
  }
  const next = {
    ...current,
    title: String(payload.title || current.title).slice(0, 180),
    type,
    filename,
    updatedAt: new Date().toISOString()
  };
  await writeFile(join(artifactRoot, filename), String(payload.content ?? ''), 'utf8');
  index[position] = next;
  await saveArtifactIndex(index);
  return { ...next, content: String(payload.content ?? '') };
}

async function deleteArtifactRecord(id) {
  const index = await loadArtifactIndex();
  const target = index.find(item => item.id === id);
  if (!target) return false;
  try { await unlink(join(artifactRoot, target.filename)); } catch {}
  try { await unlink(join(storageRoot, `${id}.json`)); } catch {}
  await saveArtifactIndex(index.filter(item => item.id !== id));
  return true;
}

function jsonResponse(response, status, value, cors = false) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...(cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' } : {})
  });
  response.end(JSON.stringify(value));
}

function writeEvent(response, event) {
  if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
}

function cleanClaudeStderr(value) {
  return String(value || '')
    .split(/\r?\n/)
    .filter(line => !/no stdin data received in 3s/i.test(line))
    .join('\n')
    .trim();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      data += chunk;
      if (data.length > 38_000_000) reject(new Error('Request body too large'));
    });
    request.on('end', () => resolve(data));
    request.on('error', reject);
  });
}

function safeExtensionFromName(name, fallback = 'bin') {
  const ext = String(name || '').split('.').pop()?.toLowerCase() || fallback;
  return ext.replace(/[^a-z0-9]/g, '').slice(0, 12) || fallback;
}

async function storeProjectFile(payload) {
  const match = String(payload.dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match || match[2] !== ';base64') throw new Error('Expected a base64 data URL');
  const type = String(payload.type || match[1] || 'application/octet-stream').slice(0, 120);
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.byteLength > 25 * 1024 * 1024) throw new Error('Project file exceeds the 25MB per-file limit');
  const id = safeId(payload.id) || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const ext = safeExtensionFromName(payload.name, type.split('/').pop() || 'bin');
  const filename = `${id}.${ext}`;
  const relativePath = `data/project-files/${filename}`;
  await writeFile(join(projectFilesRoot, filename), buffer);
  return {
    id,
    name: String(payload.name || filename).slice(0, 240),
    type,
    size: buffer.byteLength,
    relativePath,
    storedAt: new Date().toISOString()
  };
}

async function deleteProjectFileRecord(id) {
  const safe = safeId(id);
  if (!safe) return false;
  const entries = await readdir(projectFilesRoot);
  const filename = entries.find(name => name === safe || name.startsWith(`${safe}.`));
  if (!filename) return false;
  await unlink(join(projectFilesRoot, filename));
  return true;
}

function mapModel(model) {
  const allowed = new Set([
    'claude-opus-4-6',
    'claude-opus-4-5',
    'claude-sonnet-4-5'
  ]);
  const value = String(model || '');
  return allowed.has(value) ? value : 'claude-sonnet-4-5';
}

function renderSystemPrompt(model) {
  const selected = mapModel(model);
  const modelDetails = {
    'claude-opus-4-6': {
      identity: 'Claude is Claude Opus 4.6. If asked what model it is, Claude answers with this exact model identity and does not claim to be a different Claude model.',
      knowledgeCutoff: 'May 2025'
    },
    'claude-opus-4-5': {
      identity: 'Claude is Claude Opus 4.5. If asked what model it is, Claude answers with this exact model identity and does not claim to be a different Claude model.',
      knowledgeCutoff: 'May 2025'
    },
    'claude-sonnet-4-5': {
      identity: 'Claude is Claude Sonnet 4.5. If asked what model it is, Claude answers with this exact model identity and does not claim to be a different Claude model.',
      knowledgeCutoff: 'January 2025'
    }
  };
  const details = modelDetails[selected] || modelDetails['claude-sonnet-4-5'];
  const currentDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date());
  return systemPromptTemplate
    .replaceAll('{{current_date}}', currentDate)
    .replace('{{model_identity}}', details.identity)
    .replace('{{knowledge_cutoff}}', details.knowledgeCutoff);
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isTextProjectFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  const ext = name.split('.').pop() || '';
  return type.startsWith('text/')
    || [
      'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl',
      'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
      'py', 'rb', 'php', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
      'go', 'rs', 'swift', 'kt', 'kts', 'sh', 'bat', 'cmd', 'ps1',
      'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'sql', 'log'
    ].includes(ext);
}

function safeProjectFilePath(relativePath) {
  const cleanPath = normalize(String(relativePath || '')).replace(/^([.][.][/\\])+/, '');
  const fullPath = resolve(root, cleanPath);
  const allowedRoot = resolve(root, 'data', 'project-files');
  const fromAllowedRoot = relative(allowedRoot, fullPath);
  if (!fromAllowedRoot || fromAllowedRoot.startsWith('..') || fromAllowedRoot.includes(':')) return null;
  return { cleanPath, fullPath };
}

async function loadStoredProjectText(file, maxChars) {
  if (!file?.relativePath || !isTextProjectFile(file)) return null;
  const safePath = safeProjectFilePath(file.relativePath);
  if (!safePath) return null;
  try {
    const content = await readFile(safePath.fullPath, 'utf8');
    return {
      content: content.slice(0, maxChars),
      chars: content.length,
      truncated: content.length > maxChars
    };
  } catch {
    return null;
  }
}

function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function loadRequestedProjectFiles(project, prompt, maxFiles = 5, maxCharsEach = 60000) {
  const files = Array.isArray(project?.files) ? project.files : [];
  if (!files.length) return [];
  const text = normalizedText(prompt);
  const wantsAll = /\b(all|every)\b.*\b(project )?files?\b/i.test(prompt)
    || /全部|所有|项目文件|项目知识/.test(prompt);
  const matches = [];
  for (const file of files) {
    if (!file?.relativePath || file?.vision || !isTextProjectFile(file)) continue;
    // Readable files are already present in the inline project context. Do not
    // ask the bridge to load them again on a later turn.
    if (file.readable && String(file.content || '').trim()) continue;
    const name = String(file.name || '').trim();
    const lowerName = normalizedText(name);
    const baseName = normalizedText(name.replace(/\.[^.]+$/, ''));
    const mentioned = lowerName && text.includes(lowerName)
      || (baseName.length >= 3 && text.includes(baseName));
    if (!wantsAll && !mentioned) continue;
    const inlineContent = String(file.content || '');
    const loaded = file.readable
      ? { content: inlineContent.slice(0, maxCharsEach), chars: inlineContent.length, truncated: inlineContent.length > maxCharsEach }
      : await loadStoredProjectText(file, maxCharsEach);
    if (!loaded?.content?.trim()) continue;
    matches.push({
      ...file,
      content: loaded.content,
      chars: loaded.chars,
      truncated: loaded.truncated,
      source: file.readable ? 'inline' : 'bridge-read'
    });
    if (matches.length >= maxFiles) break;
  }
  return matches;
}

async function buildProjectContextPrompt(project, readToolAvailable = false) {
  if (!project || typeof project !== 'object') return '';
  const name = String(project.name || 'Untitled project').slice(0, 200);
  const instructions = String(project.instructions || '').trim().slice(0, 12000);
  const files = Array.isArray(project.files) ? project.files.slice(0, 30) : [];
  const listedOnlyInstruction = readToolAvailable
    ? 'For listed-only text files with a bridge-readable path, use the Read tool on the exact path before answering questions about their contents.'
    : 'For listed-only text files, the local bridge may include requested file contents when the user mentions a filename or asks to read project files. If the contents are not present in inline or bridge-read project knowledge, say that the file is listed but not loaded.';
  const sections = [
    `Current project: ${name}`,
    `Use the project instructions and inline project knowledge as context for this conversation. The project file list is always available, but listed files are not automatically read unless their content appears in the inline knowledge section. ${listedOnlyInstruction} Do not claim to know the contents of a listed-only file.`
  ];

  if (instructions) {
    sections.push(`Project instructions:\n${instructions}`);
  }

  if (files.length) {
    const fileList = files.map((file, index) => {
      const filename = String(file?.name || `file-${index + 1}`).slice(0, 240);
      const meta = `name="${filename}", type="${String(file?.type || 'unknown').slice(0, 120)}", size="${formatBytes(file?.size)}"`;
      const relativePath = file?.relativePath
        ? normalize(String(file.relativePath)).replace(/^([.][.][/\\])+/, '')
        : '';
      const access = relativePath ? ` path="${relativePath}" access="bridge-readable"` : ' access="listed-only"';
      if (file?.vision && file?.relativePath) {
        return `<project_file_list_item ${meta}${access} kind="image">Image file listed in project knowledge. Its visual content is not inline.</project_file_list_item>`;
      }
      const reason = String(file?.skippedReason || (file?.readable ? 'Inline content included below' : 'Content not included in context')).slice(0, 200);
      return `<project_file_list_item ${meta}${access} kind="file">${reason}</project_file_list_item>`;
    }).join('\n\n');
    sections.push(`Project file list:\n${fileList}`);

    const inlineFiles = [];
    let remainingInlineBudget = 500000;
    for (const file of files) {
      if (remainingInlineBudget <= 0) break;
      // Small text files are read by the browser and included explicitly. Large or
      // on-request files stay listed-only until Claude invokes the Read tool.
      let content = file?.readable ? String(file.content || '') : '';
      if (!content.trim()) continue;
      const clipped = content.slice(0, Math.min(remainingInlineBudget, 100000));
      remainingInlineBudget -= clipped.length;
      inlineFiles.push({ ...file, content: clipped, bridgeLoaded: !file?.readable });
    }
    if (inlineFiles.length) {
      const renderedInlineFiles = inlineFiles.map((file, index) => {
        const filename = String(file?.name || `inline-file-${index + 1}`).slice(0, 240);
        const meta = `name="${filename}", type="${String(file?.type || 'unknown').slice(0, 120)}", size="${formatBytes(file?.size)}"`;
        const content = String(file.content || '').slice(0, 80000);
        const source = file.bridgeLoaded ? 'bridge-loaded' : 'uploaded-inline';
        return `<project_inline_file ${meta} source="${source}">\n${content}\n</project_inline_file>`;
      }).join('\n\n');
      sections.push(`Inline project knowledge:\n${renderedInlineFiles}`);
    }
  }

  return `Project context:\n${sections.join('\n\n')}`;
}

function buildBridgeReadProjectPrompt(files) {
  const loadedFiles = Array.isArray(files) ? files : [];
  if (!loadedFiles.length) return '';
  const rendered = loadedFiles.map((file, index) => {
    const filename = String(file?.name || `bridge-read-file-${index + 1}`).slice(0, 240);
    const meta = `name="${filename}", type="${String(file?.type || 'unknown').slice(0, 120)}", size="${formatBytes(file?.size)}"`;
    const source = String(file?.source || 'bridge-read').slice(0, 40);
    const truncated = file?.truncated ? 'true' : 'false';
    const chars = Number(file?.chars || String(file?.content || '').length);
    const content = String(file?.content || '').slice(0, 80000);
    return `<project_bridge_read_file ${meta} source="${source}" chars="${chars}" truncated="${truncated}">\n${content}\n</project_bridge_read_file>`;
  }).join('\n\n');
  return `Bridge-read project knowledge for this turn:\n${rendered}`;
}

function projectNeedsReadTool(project) {
  const files = Array.isArray(project?.files) ? project.files : [];
  return files.some(file => file?.relativePath && !file?.vision
    && !(file.readable && String(file.content || '').trim()));
}

function buildAttachmentContextPrompt(attachments) {
  const files = Array.isArray(attachments) ? attachments.slice(0, 20) : [];
  if (!files.length) return '';
  const rendered = files.map((file, index) => {
    const name = String(file?.name || `attachment-${index + 1}`).slice(0, 240);
    const type = String(file?.type || 'unknown').slice(0, 120);
    const relativePath = file?.relativePath
      ? normalize(String(file.relativePath)).replace(/^([.][.][/\\])+/, '')
      : '';
    const kind = file?.vision ? 'image' : 'file';
    const pathAttr = relativePath ? ` path="${relativePath}"` : '';
    const instruction = relativePath
      ? 'Use the Read tool on the provided path before describing this attachment. For images, inspect the image visually with Read; for text files, quote only what the tool returns.'
      : 'The attachment has no bridge-readable path in this turn, so do not claim to have inspected it.';
    return `<message_attachment name="${name}" type="${type}" size="${formatBytes(file?.size)}" kind="${kind}"${pathAttr}>${instruction}</message_attachment>`;
  }).join('\n\n');
  return `Current message attachments:\n${rendered}`;
}

function attachmentsNeedReadTool(attachments) {
  return Boolean(Array.isArray(attachments) && attachments.some(file => file?.relativePath));
}

function buildInteractionModePrompt(payload) {
  const sections = [];
  const style = String(payload.style || 'Normal');
  if (style === 'Concise') {
    sections.push('Response style: be concise and direct unless the user asks for detail.');
  } else if (style === 'Detailed') {
    sections.push('Response style: be thorough, explanatory, and include useful context.');
  } else {
    sections.push('Response style: normal conversational detail.');
  }
  if (payload.researchEnabled) {
    sections.push('Research mode is enabled: reason carefully, compare evidence when available, and structure the answer as a researched response.');
  }
  if (payload.webSearchEnabled) {
    sections.push('Web search is enabled in the UI, but live web search is not connected in this local bridge yet. If current external information is needed, say so clearly instead of pretending to browse.');
  }
  if (payload.requestConversationTitle) {
    sections.push('This is the first response in a new conversation. After the complete answer, output exactly one short conversation title in <conversation_title>Title</conversation_title>. Keep it under 50 characters, reflect the actual topic, and do not mention or explain this tag.');
  }
  return sections.join('\n');
}

function buildAllowedTools(payload) {
  if (payload.toolAccess === 'Off') return '';
  const tools = new Set();
  if (projectNeedsReadTool(payload.project)) tools.add('Read');
  if (attachmentsNeedReadTool(payload.attachments)) tools.add('Read');
  return Array.from(tools).join(',');
}

function buildRecoveryPrompt(currentPrompt, rawHistory) {
  const history = Array.isArray(rawHistory) ? rawHistory.slice(-40) : [];
  const prior = history
    .filter((item, index) => !(index === history.length - 1 && item?.role === 'user' && String(item?.content || '').trim() === currentPrompt))
    .map(item => {
      const role = item?.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(item?.content || '').slice(0, 8000)}`;
    })
    .join('\n\n')
    .slice(-80000);
  if (!prior) return currentPrompt;
  return `The previous Claude Code session could not be resumed. Continue the conversation using this recovered transcript. Do not mention the recovery unless asked.\n\n${prior}\n\nUser: ${currentPrompt}`;
}

function handleClaudeEvent(message, response, state) {
  if (message.type === 'system' && message.subtype === 'init') {
    writeEvent(response, {
      type: 'session',
      sessionId: message.session_id,
      model: message.model,
      auth: message.apiKeySource === 'none' ? 'subscription' : 'api'
    });
    return;
  }

  if (message.type === 'rate_limit_event') {
    writeEvent(response, { type: 'limit', ...message.rate_limit_info });
    return;
  }

  if (message.type === 'stream_event') {
    const event = message.event || {};
    if (event.type === 'content_block_start') {
      const block = event.content_block || {};
      state.blocks.set(event.index, block.type);
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        writeEvent(response, { type: 'thinking_start' });
      }
      if (block.type === 'tool_use') {
        writeEvent(response, {
          type: 'tool_start',
          id: block.id,
          name: block.name,
          input: block.input || {}
        });
      }
      return;
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        state.sawTextDelta = true;
        writeEvent(response, { type: 'text_delta', text: delta.text });
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        state.sawThinkingDelta = true;
        writeEvent(response, { type: 'thinking_delta', text: delta.thinking });
      } else if (delta.type === 'input_json_delta') {
        writeEvent(response, { type: 'tool_input_delta', json: delta.partial_json || '' });
      }
      return;
    }
  }

  if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text && !state.sawTextDelta) {
        state.sawTextDelta = true;
        writeEvent(response, { type: 'text_delta', text: block.text });
      }
      if (block.type === 'thinking' && block.thinking && !state.sawThinkingDelta) {
        state.sawThinkingDelta = true;
        writeEvent(response, { type: 'thinking_delta', text: block.thinking });
      }
      if (block.type === 'tool_use') {
        writeEvent(response, {
          type: 'tool_start',
          id: block.id,
          name: block.name,
          input: block.input || {}
        });
      }
    }
    return;
  }

  if (message.type === 'user' && Array.isArray(message.message?.content)) {
    for (const block of message.message.content) {
      if (block.type === 'tool_result') {
        writeEvent(response, {
          type: 'tool_result',
          id: block.tool_use_id,
          error: Boolean(block.is_error),
          content: block.content
        });
      }
    }
    return;
  }

  if (message.type === 'result') {
    if (message.is_error && state.suppressErrors) {
      state.resumeFailed = true;
      return;
    }
    writeEvent(response, {
      type: message.is_error ? 'error' : 'done',
      sessionId: message.session_id,
      result: message.result || '',
      reason: message.stop_reason || message.subtype,
      usage: message.usage || null
    });
  }
}

function normalizeProvider(value) {
  const provider = String(value || '').trim();
  return ['mock', 'custom', 'claudeCode'].includes(provider) ? provider : 'mock';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function streamText(response, text, chunkSize = 32) {
  const value = String(text || '');
  for (let index = 0; index < value.length; index += chunkSize) {
    writeEvent(response, { type: 'text_delta', text: value.slice(index, index + chunkSize) });
    await delay(12);
  }
}

async function buildOpenAICompatibleMessages(rawHistory, prompt, system, attachments = []) {
  const messages = [{ role: 'system', content: system }];
  const history = Array.isArray(rawHistory) ? rawHistory.slice(-40) : [];
  for (const item of history) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item?.content || '').trim();
    if (content) messages.push({ role, content: content.slice(0, 12000) });
  }
  const last = messages[messages.length - 1];
  if (!(last?.role === 'user' && last.content === prompt)) {
    const parts = [{ type: 'text', text: prompt }];
    const attachmentParts = await buildOpenAICompatibleAttachmentParts(attachments);
    messages.push({ role: 'user', content: parts.concat(attachmentParts) });
  }
  return messages;
}

async function buildOpenAICompatibleAttachmentParts(attachments) {
  const parts = [];
  const files = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
  for (const file of files) {
    const name = String(file?.name || 'attachment').slice(0, 240);
    const safePath = safeProjectFilePath(file?.relativePath);
    if (!safePath) continue;
    const type = String(file?.type || '').toLowerCase();
    if (file?.vision || type.startsWith('image/')) {
      const buffer = await readFile(safePath.fullPath);
      const mime = type.startsWith('image/') ? type : 'image/png';
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` }
      });
      continue;
    }
    if (isTextProjectFile(file)) {
      const content = await loadStoredProjectText(file, 60000);
      if (content) {
        parts.push({
          type: 'text',
          text: `Attachment "${name}" content:\n${content}`
        });
      }
    }
  }
  return parts;
}

async function handleMockChat({ payload, prompt, selectedModel }, response) {
  const sessionId = `mock-${Date.now()}`;
  writeEvent(response, { type: 'session', sessionId, model: 'mock' });
  if (payload.thinkingEnabled) {
    writeEvent(response, { type: 'thinking_start' });
    writeEvent(response, { type: 'thinking_delta', text: 'Checking the request and available context...\n' });
    await delay(80);
  }
  const files = Array.isArray(payload.project?.files) ? payload.project.files : [];
  if (files.length) {
    const id = 'mock-project-context';
    writeEvent(response, { type: 'tool_start', id, name: 'Project context', input: { files: files.length } });
    await delay(80);
    writeEvent(response, { type: 'tool_result', id, error: false, content: `Loaded ${files.length} project file listing item(s).` });
  }
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length) {
    const id = 'mock-attachment-read';
    writeEvent(response, { type: 'tool_start', id, name: 'Read attachment', input: { files: attachments.map(file => file.name || 'attachment') } });
    await delay(80);
    writeEvent(response, { type: 'tool_result', id, error: false, content: `Attachment read is simulated in Mock mode for ${attachments.length} file(s).` });
  }
  const lower = prompt.toLowerCase();
  const text = /artifact|html|网页|页面|创建|create/.test(lower)
    ? '当前是本地 Mock Claude。我可以先把交互和 Artifact 流程跑通。\n\n<artifact type="html" title="Mock HTML preview"><!doctype html><html><body><h1>Hello from Mock Claude</h1><p>Edit this artifact to preview it.</p></body></html></artifact>\n\n这个 Artifact 已经可以被界面解析、收起并从顶部胶囊重新打开。'
    : '当前是本地 Mock Claude，这次请求不会消耗中转站额度。你可以先用它检查上下文、思考链和工具调用框。';
  await streamText(response, text);
  writeEvent(response, { type: 'done', sessionId, reason: 'mock_stop' });
  response.end();
}

async function handleCustomChat({ payload, prompt, activeSystemPrompt }, response) {
  const baseUrl = String(payload.customBaseUrl || payload.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(payload.customApiKey || payload.apiKey || '').trim();
  const model = String(payload.customModel || '').trim();
  if (!baseUrl) throw new Error('Custom provider needs a Base URL.');
  if (!apiKey) throw new Error('Custom provider needs an API key.');
  if (!model) throw new Error('Custom provider needs a model name.');
  writeEvent(response, { type: 'session', sessionId: `custom-${Date.now()}`, model });
  let customSystemPrompt = activeSystemPrompt;
  if (payload.thinkingEnabled) {
    writeEvent(response, { type: 'thinking_start' });
    writeEvent(response, { type: 'thinking_delta', text: 'Preparing conversation context, project knowledge, and attachments before sending the request.\n' });
  }
  const projectFiles = Array.isArray(payload.project?.files) ? payload.project.files : [];
  const listedProjectFiles = projectFiles.filter(file => !(file?.readable && String(file.content || '').trim()));
  if (listedProjectFiles.length) {
    const readableCount = projectFiles.filter(file => file?.readable).length;
    const listedCount = listedProjectFiles.length;
    const id = `custom-project-${Date.now()}`;
    writeEvent(response, {
      type: 'tool_start',
      id,
      name: 'Project knowledge',
      input: { files: listedProjectFiles.length, inline: readableCount, listed: listedCount }
    });
    writeEvent(response, {
      type: 'tool_result',
      id,
      error: false,
      content: `Prepared ${listedProjectFiles.length} project file item(s): ${readableCount} inline, ${listedCount} listed-only.`
    });
  }
  const bridgeReadFiles = await loadRequestedProjectFiles(payload.project, prompt);
  if (bridgeReadFiles.length) {
    const id = `custom-project-read-${Date.now()}`;
    writeEvent(response, {
      type: 'tool_start',
      id,
      name: 'Read project file',
      input: { files: bridgeReadFiles.map(file => file.name || 'project file') }
    });
    customSystemPrompt = [customSystemPrompt, buildBridgeReadProjectPrompt(bridgeReadFiles)].filter(Boolean).join('\n\n');
    writeEvent(response, {
      type: 'tool_result',
      id,
      error: false,
      content: `Read ${bridgeReadFiles.length} project file(s): ${bridgeReadFiles.map(file => {
        const loadedChars = String(file.content || '').length;
        const status = file.truncated ? `truncated to ${loadedChars} chars` : `${loadedChars} chars loaded`;
        return `${file.name} (${status})`;
      }).join(', ')}.`
    });
  }
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length) {
    const id = `custom-attachments-${Date.now()}`;
    writeEvent(response, {
      type: 'tool_start',
      id,
      name: 'Attachments',
      input: { files: attachments.map(file => file.name || 'attachment') }
    });
    writeEvent(response, {
      type: 'tool_result',
      id,
      error: false,
      content: `Prepared ${attachments.length} attachment(s) for the model request.`
    });
  }
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: await buildOpenAICompatibleMessages(payload.history, prompt, customSystemPrompt, payload.attachments)
    })
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 800);
    throw new Error(`Custom provider returned ${upstream.status}: ${detail}`);
  }
  if (!upstream.body) throw new Error('Custom provider returned no response body.');
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === '[DONE]') { finished = true; break; }
      try {
        const parsed = JSON.parse(raw);
        const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? '';
        if (delta) writeEvent(response, { type: 'text_delta', text: String(delta) });
      } catch {}
    }
  }
  writeEvent(response, { type: 'done', reason: 'stop' });
  response.end();
}

async function handleCustomConnectionTest(request, response) {
  if (request.method !== 'POST') {
    jsonResponse(response, 405, { error: 'Method not allowed' });
    return;
  }
  const payload = JSON.parse(await readBody(request));
  const baseUrl = String(payload.baseUrl || payload.customBaseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(payload.apiKey || payload.customApiKey || '').trim();
  const model = String(payload.model || payload.customModel || '').trim();
  if (!baseUrl || !apiKey || !model) {
    jsonResponse(response, 400, { ok: false, error: 'Base URL, API key, and model are required.' });
    return;
  }
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 16,
      messages: [
        { role: 'system', content: 'Reply with ok.' },
        { role: 'user', content: 'ping' }
      ]
    })
  });
  const detail = (await upstream.text()).slice(0, 500);
  if (!upstream.ok) {
    jsonResponse(response, 502, { ok: false, error: `Relay returned ${upstream.status}: ${detail}` });
    return;
  }
  jsonResponse(response, 200, { ok: true });
}

async function handleChat(request, response) {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });

  try {
    const payload = JSON.parse(await readBody(request));
    const prompt = String(payload.message || '').trim();
    if (!prompt) throw new Error('Message is required');
    const provider = normalizeProvider(payload.provider);
    const selectedModel = mapModel(payload.model);
    const projectContextPrompt = await buildProjectContextPrompt(payload.project, provider === 'claudeCode');
    const attachmentContextPrompt = buildAttachmentContextPrompt(payload.attachments);
    const interactionModePrompt = buildInteractionModePrompt(payload);
    const activeSystemPrompt = [
      renderSystemPrompt(selectedModel),
      interactionModePrompt,
      projectContextPrompt,
      attachmentContextPrompt
    ].filter(Boolean).join('\n\n');

    if (provider === 'mock') {
      await handleMockChat({ payload, prompt, selectedModel }, response);
      return;
    }
    if (provider === 'custom') {
      await handleCustomChat({ payload, prompt, activeSystemPrompt }, response);
      return;
    }
    if (!existsSync(claudeBinary)) throw new Error('Claude Code is not installed.');

    const allowedTools = buildAllowedTools(payload);
    const baseArgs = [
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--max-turns', '1',
      '--tools', allowedTools,
      '--model', selectedModel,
      '--system-prompt', activeSystemPrompt
    ];

    if (allowedTools) {
      baseArgs.push('--allowedTools', allowedTools, '--permission-mode', 'auto');
    }

    if (payload.thinkingEnabled) baseArgs.push('--effort', 'high');
    let activeChild = null;
    let retriedWithoutSession = false;

    const startClaude = useSession => {
      const requestPrompt = useSession ? prompt : buildRecoveryPrompt(prompt, payload.history);
      const args = ['-p', requestPrompt, ...baseArgs];
      if (useSession && payload.sessionId) args.push('--resume', String(payload.sessionId));
      const child = spawn(claudeBinary, args, {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ANTHROPIC_API_KEY: '' }
      });
      activeChild = child;
      const state = {
        buffer: '', errorBuffer: '', blocks: new Map(),
        sawTextDelta: false, sawThinkingDelta: false,
        suppressErrors: Boolean(useSession), resumeFailed: false
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        state.buffer += chunk;
        const lines = state.buffer.split(/\r?\n/);
        state.buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { handleClaudeEvent(JSON.parse(line), response, state); }
          catch (error) { writeEvent(response, { type: 'bridge_warning', message: error.message }); }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { state.errorBuffer += chunk; });
      child.on('error', error => {
        writeEvent(response, { type: 'error', message: error.message });
        response.end();
      });
      child.on('close', code => {
        if (state.buffer.trim()) {
          try { handleClaudeEvent(JSON.parse(state.buffer), response, state); } catch {}
        }
        if ((code !== 0 || state.resumeFailed) && useSession && !state.sawTextDelta && !retriedWithoutSession) {
          retriedWithoutSession = true;
          writeEvent(response, { type: 'session_reset', reason: 'Previous Claude Code session was unavailable' });
          startClaude(false);
          return;
        }
        if (code !== 0) {
          const stderr = cleanClaudeStderr(state.errorBuffer);
          const diagnostic = `Claude Code exited with code ${code}. tools="${allowedTools || 'none'}", attachments=${Array.isArray(payload.attachments) ? payload.attachments.length : 0}, projectFiles=${Array.isArray(payload.project?.files) ? payload.project.files.length : 0}.`;
          writeEvent(response, {
            type: 'error',
            message: stderr ? `${stderr}\n\n${diagnostic}` : `${diagnostic} The local bridge could not get a detailed error from Claude Code.`
          });
        }
        response.end();
      });
    };

    startClaude(Boolean(payload.sessionId));
    response.on('close', () => {
      if (!response.writableEnded && activeChild && !activeChild.killed) activeChild.kill();
    });
  } catch (error) {
    writeEvent(response, { type: 'error', message: error.message });
    response.end();
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const safePath = normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  createReadStream(filePath).pipe(response);
}

async function handleArtifactApi(request, response, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = safeId(parts[2]);

  if (request.method === 'GET' && !id) {
    jsonResponse(response, 200, { artifacts: await listArtifacts() });
    return;
  }

  if (request.method === 'POST' && !id) {
    const artifact = await createArtifactRecord(JSON.parse(await readBody(request)));
    jsonResponse(response, 201, { artifact });
    return;
  }

  if (request.method === 'PUT' && id) {
    const artifact = await updateArtifactRecord(id, JSON.parse(await readBody(request)));
    jsonResponse(response, artifact ? 200 : 404, artifact ? { artifact } : { error: 'Artifact not found' });
    return;
  }

  if (request.method === 'DELETE' && id) {
    const deleted = await deleteArtifactRecord(id);
    jsonResponse(response, deleted ? 200 : 404, { deleted });
    return;
  }

  jsonResponse(response, 405, { error: 'Method not allowed' });
}

async function loadStorage(id) {
  try {
    const parsed = JSON.parse(await readFile(join(storageRoot, `${id}.json`), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { personal: {}, shared: {} };
  } catch {
    return { personal: {}, shared: {} };
  }
}

async function saveStorage(id, store) {
  await writeFile(join(storageRoot, `${id}.json`), JSON.stringify(store, null, 2), 'utf8');
}

function validStorageKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length < 200 && !/[\s/\\'"]/.test(key);
}

async function handleArtifactStorage(request, response, url) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS'
    });
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    jsonResponse(response, 405, { error: 'Method not allowed' }, true);
    return;
  }

  const id = safeId(url.pathname.split('/').filter(Boolean)[2]);
  if (!id) {
    jsonResponse(response, 400, { error: 'Invalid artifact id' }, true);
    return;
  }

  const payload = JSON.parse(await readBody(request));
  const scope = payload.shared ? 'shared' : 'personal';
  const store = await loadStorage(id);
  store.personal ||= {};
  store.shared ||= {};
  const table = store[scope];

  if (payload.action === 'list') {
    const prefix = String(payload.prefix || '');
    jsonResponse(response, 200, { keys: Object.keys(table).filter(key => key.startsWith(prefix)), prefix, shared: Boolean(payload.shared) }, true);
    return;
  }

  if (!validStorageKey(payload.key)) {
    jsonResponse(response, 400, { error: 'Invalid storage key' }, true);
    return;
  }

  if (payload.action === 'get') {
    if (!(payload.key in table)) {
      jsonResponse(response, 404, { error: 'Key not found' }, true);
      return;
    }
    jsonResponse(response, 200, { key: payload.key, value: table[payload.key], shared: Boolean(payload.shared) }, true);
    return;
  }

  if (payload.action === 'set') {
    const value = String(payload.value ?? '');
    if (Buffer.byteLength(value, 'utf8') > 5 * 1024 * 1024) {
      jsonResponse(response, 413, { error: 'Value exceeds 5MB limit' }, true);
      return;
    }
    table[payload.key] = value;
    await saveStorage(id, store);
    jsonResponse(response, 200, { key: payload.key, value, shared: Boolean(payload.shared) }, true);
    return;
  }

  if (payload.action === 'delete') {
    const deleted = delete table[payload.key];
    await saveStorage(id, store);
    jsonResponse(response, 200, { key: payload.key, deleted, shared: Boolean(payload.shared) }, true);
    return;
  }

  jsonResponse(response, 400, { error: 'Unknown storage action' }, true);
}

async function handleProjectFileApi(request, response) {
  if (request.method === 'POST') {
    const storedFile = await storeProjectFile(JSON.parse(await readBody(request)));
    jsonResponse(response, 201, { file: storedFile });
    return;
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const deleted = await deleteProjectFileRecord(url.searchParams.get('id'));
    jsonResponse(response, 200, { deleted });
    return;
  }
  jsonResponse(response, 405, { error: 'Method not allowed' });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    handleChat(request, response);
    return;
  }
  if (url.pathname === '/api/test-custom-connection') {
    handleCustomConnectionTest(request, response).catch(error => jsonResponse(response, 500, { ok: false, error: error.message }));
    return;
  }
  if (url.pathname === '/api/project-files') {
    handleProjectFileApi(request, response).catch(error => jsonResponse(response, 500, { error: error.message }));
    return;
  }
  if (url.pathname === '/api/shared-state') {
    handleSharedStateApi(request, response).catch(error => jsonResponse(response, 500, { error: error.message }));
    return;
  }
  if (url.pathname === '/api/artifacts' || url.pathname.startsWith('/api/artifacts/')) {
    handleArtifactApi(request, response, url).catch(error => jsonResponse(response, 500, { error: error.message }));
    return;
  }
  if (url.pathname.startsWith('/api/artifact-storage/')) {
    handleArtifactStorage(request, response, url).catch(error => jsonResponse(response, 500, { error: error.message }, true));
    return;
  }
  if (request.method === 'GET') {
    serveStatic(request, response);
    return;
  }
  response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Method not allowed');
});

server.listen(port, host, () => {
  console.log(`Claude local app: http://127.0.0.1:${port}`);
  const lanAddresses = Object.values(networkInterfaces())
    .flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal)
    .filter(item => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))
    .map(item => `http://${item.address}:${port}`);
  if (lanAddresses.length) {
    console.log(`Phone on the same Wi-Fi: ${lanAddresses.join(' or ')}`);
    writeFile(
      join(root, 'phone-url.txt'),
      `Connect your phone to the same Wi-Fi as this computer, then open:\n\n${lanAddresses.join('\n')}\n`,
      'utf8'
    ).catch(error => console.warn('Could not write phone-url.txt', error));
  }
  console.log('Authentication: Claude Code subscription (no API key)');
});
