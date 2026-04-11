import { useCallback, useEffect, useState } from 'react';
import { fetchFiles, readFile, writeFile, type FileEntry } from '../lib/api.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 *  WorkspaceExplorer
 *  ─────────────────
 *  File navigator + editor scoped to an agent's workspace.
 *  Replaces the chat area when active.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function WorkspaceExplorer({ agentId }: { agentId: string }) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = fileContent !== originalContent;

  // Load directory listing
  const loadDir = useCallback(async (dirPath: string) => {
    try {
      setError(null);
      const files = await fetchFiles(agentId, dirPath);
      setEntries(files);
      setCurrentPath(dirPath);
      setSelectedFile(null);
      setFileContent('');
      setOriginalContent('');
    } catch (err) {
      setError(String(err));
    }
  }, [agentId]);

  useEffect(() => { loadDir(''); }, [loadDir]);

  // Open a file
  const openFile = async (filePath: string) => {
    try {
      setError(null);
      const content = await readFile(agentId, filePath);
      setSelectedFile(filePath);
      setFileContent(content);
      setOriginalContent(content);
    } catch (err) {
      setError(String(err));
    }
  };

  // Save file
  const handleSave = async () => {
    if (!selectedFile || !isDirty) return;
    setSaving(true);
    try {
      await writeFile(agentId, selectedFile, fileContent);
      setOriginalContent(fileContent);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // Navigate into directory or open file
  const handleEntryClick = (entry: FileEntry) => {
    const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    if (entry.type === 'directory') {
      loadDir(entryPath);
    } else {
      openFile(entryPath);
    }
  };

  // Breadcrumb parts
  const pathParts = currentPath ? currentPath.split('/') : [];

  return (
    <div className="flex flex-1 flex-col rounded-md overflow-hidden min-w-0 bg-surface-container-high">

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-container">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          <button
            onClick={() => loadDir('')}
            className="font-mono text-[11px] text-primary/60 hover:text-primary transition-colors flex-shrink-0"
          >
            workspace
          </button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1 flex-shrink-0">
              <span className="text-on-surface-variant/20 text-[10px]">/</span>
              <button
                onClick={() => loadDir(pathParts.slice(0, i + 1).join('/'))}
                className="font-mono text-[11px] text-on-surface-variant/60 hover:text-on-surface transition-colors"
              >
                {part}
              </button>
            </span>
          ))}
          {selectedFile && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <span className="text-on-surface-variant/20 text-[10px]">/</span>
              <span className="font-mono text-[11px] text-on-surface">
                {selectedFile.split('/').pop()}
              </span>
              {isDirty && <span className="text-primary text-[9px]">●</span>}
            </span>
          )}
        </div>

        {/* Save button */}
        {selectedFile && (
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="rounded px-3 py-1 text-[11px] font-medium transition-all disabled:opacity-20
              bg-primary/20 text-primary hover:bg-primary/30"
          >
            {saving ? 'saving…' : 'Save'}
          </button>
        )}

        {/* Back to listing */}
        {selectedFile && (
          <button
            onClick={() => { setSelectedFile(null); setFileContent(''); setOriginalContent(''); }}
            className="rounded px-2 py-1 text-[11px] text-on-surface-variant/70 hover:text-on-surface-variant transition-colors"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-2 bg-error/10">
          <p className="font-mono text-[10px] text-error/70">{error}</p>
        </div>
      )}

      {/* ── Content area ─────────────────────────────────────────── */}
      {selectedFile ? (
        /* ── File editor ──────────────────────────────────────── */
        <textarea
          className="flex-1 w-full resize-none bg-transparent px-4 py-3 font-mono text-[12px] text-on-surface/90 leading-relaxed outline-none"
          style={{ tabSize: 2 }}
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          spellCheck={false}
        />
      ) : (
        /* ── Directory listing ────────────────────────────────── */
        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="font-mono text-[11px] text-on-surface-variant/60 p-4 italic">Empty directory</p>
          ) : (
            <div className="flex flex-col">
              {/* Parent directory link */}
              {currentPath && (
                <button
                  onClick={() => {
                    const parent = currentPath.split('/').slice(0, -1).join('/');
                    loadDir(parent);
                  }}
                  className="flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-container/50"
                >
                  <span className="text-[13px] opacity-40">↩</span>
                  <span className="font-mono text-[11px] text-on-surface-variant">..</span>
                </button>
              )}

              {entries.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => handleEntryClick(entry)}
                  className="group flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-container/50"
                >
                  <span className="text-[13px] opacity-50 group-hover:opacity-80 transition-opacity">
                    {entry.type === 'directory' ? '📁' : '📄'}
                  </span>
                  <span className={`font-mono text-[11px] flex-1 truncate ${
                    entry.type === 'directory' ? 'text-primary/70' : 'text-on-surface/70'
                  }`}>
                    {entry.name}
                  </span>
                  {entry.size !== undefined && (
                    <span className="font-mono text-[9px] text-on-surface-variant/25 tabular-nums">
                      {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(1)}K`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
