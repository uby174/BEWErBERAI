import React, { useMemo, useState } from 'react';
import { AnalysisResult, Improvement } from '../types';
import { downloadDocxFromDrive } from '../services/googleDriveService';

type DashboardTab = 'mustFix' | 'atsCoverage' | 'rewritePreview';
type ActiveDoc = 'resume' | 'cover';

interface Props {
  result: AnalysisResult;
  docIds: { resume?: string; cover?: string };
  originalDocs: { resume: string; cover: string };
  onReset: () => void;
}

interface DiffRow {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

const MAX_ITEMS_PER_SECTION = 6;

const TAB_CONFIG: Array<{ key: DashboardTab; label: string }> = [
  { key: 'mustFix', label: 'Must-fix' },
  { key: 'atsCoverage', label: 'ATS Coverage' },
  { key: 'rewritePreview', label: 'Rewrite Preview' },
];

const toLines = (value: string): string[] =>
  value
    .split(/\r?\n/g)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);

const buildDiffRows = (original: string, optimized: string): DiffRow[] => {
  const originalLines = toLines(original);
  const optimizedLines = toLines(optimized);
  const maxLength = Math.max(originalLines.length, optimizedLines.length);
  const rows: DiffRow[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const originalLine = originalLines[index] ?? '';
    const optimizedLine = optimizedLines[index] ?? '';

    if (originalLine === optimizedLine) {
      if (originalLine) {
        rows.push({ kind: 'same', text: originalLine });
      }
      continue;
    }

    if (originalLine) {
      rows.push({ kind: 'removed', text: originalLine });
    }
    if (optimizedLine) {
      rows.push({ kind: 'added', text: optimizedLine });
    }
  }

  return rows;
};

const sliceStrings = (items: string[]): string[] => items.slice(0, MAX_ITEMS_PER_SECTION);
const sliceImprovements = (items: Improvement[]): Improvement[] => items.slice(0, MAX_ITEMS_PER_SECTION);
const sliceDiffRows = (items: DiffRow[]): DiffRow[] => items.slice(0, MAX_ITEMS_PER_SECTION);

const renderOverflowCount = (itemCount: number): React.ReactNode => {
  const remaining = itemCount - MAX_ITEMS_PER_SECTION;
  if (remaining <= 0) return null;
  return <p className="text-[10px] text-slate-400">+{remaining} more not shown</p>;
};

const ResultsDashboard: React.FC<Props> = ({ result, docIds, originalDocs, onReset }) => {
  const [activeDoc, setActiveDoc] = useState<ActiveDoc>('resume');
  const [activeTab, setActiveTab] = useState<DashboardTab>('mustFix');
  const [expandedEvidenceIndex, setExpandedEvidenceIndex] = useState<number | null>(null);

  const baselineScore = result.scoreBreakdown.baseline;
  const enhancedScore = result.scoreBreakdown.enhanced;
  const scoreLift = baselineScore !== null && enhancedScore !== null ? enhancedScore - baselineScore : null;

  const currentDocId = activeDoc === 'resume' ? docIds.resume : docIds.cover;
  const selectedOriginalText = activeDoc === 'resume' ? originalDocs.resume : originalDocs.cover;
  const selectedOptimizedText =
    (activeDoc === 'resume' ? result.optimizedResume : result.optimizedCoverLetter) ?? '';
  const hasOptimizedText = selectedOptimizedText.trim().length > 0;
  const canDownloadDocx = Boolean(currentDocId && hasOptimizedText);

  const criticalImprovements = useMemo(
    () => result.improvements.filter(improvement => improvement.category === 'critical'),
    [result.improvements]
  );

  const evidenceItems = useMemo(
    () =>
      result.improvements.filter(improvement => {
        const evidence = improvement.evidence ?? { resumeQuotes: [], jdQuotes: [], missingKeywords: [] };
        return (
          evidence.resumeQuotes.length > 0 ||
          evidence.jdQuotes.length > 0 ||
          evidence.missingKeywords.length > 0
        );
      }),
    [result.improvements]
  );

  const diffRows = useMemo(
    () => buildDiffRows(selectedOriginalText, selectedOptimizedText),
    [selectedOriginalText, selectedOptimizedText]
  );
  const changedDiffRows = useMemo(
    () => diffRows.filter(row => row.kind !== 'same'),
    [diffRows]
  );

  const handleDownloadDocx = () => {
    if (!canDownloadDocx || !currentDocId) return;
    downloadDocxFromDrive(currentDocId, activeDoc === 'resume' ? 'Enhanced_Resume' : 'Enhanced_Cover');
  };

  const renderMustFixTab = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-rose-600">Blocking Hard Requirements</h4>
        {result.hardRequirementsMissing.length > 0 ? (
          <div className="mt-3 space-y-2">
            {sliceStrings(result.hardRequirementsMissing).map((item, index) => (
              <div key={`${item}-${index}`} className="rounded-lg border border-rose-200 bg-rose-100 px-3 py-2 text-xs text-rose-800">
                {item}
              </div>
            ))}
            {renderOverflowCount(result.hardRequirementsMissing.length)}
          </div>
        ) : (
          <p className="mt-2 text-xs text-emerald-700">No blocking hard requirements are currently missing.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Critical Issues</h4>
        {criticalImprovements.length > 0 ? (
          <div className="mt-3 space-y-3">
            {sliceImprovements(criticalImprovements).map((improvement, index) => (
              <article key={`${improvement.point ?? 'critical'}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-800">
                  {improvement.point ?? 'No critical issue detail provided.'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Impact: {improvement.impact ?? 'Not available'}
                </p>
              </article>
            ))}
            {renderOverflowCount(criticalImprovements.length)}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">No critical issues were returned.</p>
        )}
      </div>
    </div>
  );

  const renderKeywordGroup = (label: string, items: string[], tone: 'red' | 'green' | 'amber') => {
    const toneStyles =
      tone === 'red'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : tone === 'green'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-amber-200 bg-amber-50 text-amber-700';

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</h4>
        {items.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sliceStrings(items).map((item, index) => (
              <span key={`${label}-${item}-${index}`} className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${toneStyles}`}>
                {item}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">None</p>
        )}
        <div className="mt-2">{renderOverflowCount(items.length)}</div>
      </div>
    );
  };

  const renderEvidenceCard = (improvement: Improvement, index: number) => {
    const evidence = improvement.evidence ?? { resumeQuotes: [], jdQuotes: [], missingKeywords: [] };
    const expanded = expandedEvidenceIndex === index;

    return (
      <article key={`${improvement.point ?? 'evidence'}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-800">{improvement.point ?? 'No issue text provided.'}</p>
        <button
          type="button"
          onClick={() => setExpandedEvidenceIndex(expanded ? null : index)}
          className="mt-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700"
        >
          {expanded ? 'Hide Evidence' : 'Show Evidence'}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-600">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Resume Quotes</p>
              {evidence.resumeQuotes.length > 0 ? (
                sliceStrings(evidence.resumeQuotes).map((quote, quoteIndex) => (
                  <p key={`resume-${index}-${quoteIndex}`} className="mt-1 leading-relaxed">"{quote}"</p>
                ))
              ) : (
                <p className="mt-1 italic text-slate-400">No resume quote evidence.</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">JD Quotes</p>
              {evidence.jdQuotes.length > 0 ? (
                sliceStrings(evidence.jdQuotes).map((quote, quoteIndex) => (
                  <p key={`jd-${index}-${quoteIndex}`} className="mt-1 leading-relaxed">"{quote}"</p>
                ))
              ) : (
                <p className="mt-1 italic text-slate-400">No JD quote evidence.</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Missing Keywords</p>
              {evidence.missingKeywords.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {sliceStrings(evidence.missingKeywords).map((keyword, keywordIndex) => (
                    <span
                      key={`kw-${index}-${keywordIndex}`}
                      className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 italic text-slate-400">No missing keywords identified.</p>
              )}
            </div>
          </div>
        )}
      </article>
    );
  };

  const renderAtsCoverageTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4">
        {renderKeywordGroup('Matched Keywords', result.keywordCoverage.matched, 'green')}
        {renderKeywordGroup('Missing Keywords', result.keywordCoverage.missing, 'red')}
        {renderKeywordGroup('Partial Keywords', result.keywordCoverage.partial, 'amber')}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Evidence Map</h4>
        <p className="mt-1 text-[10px] text-slate-400">
          Evidence snippets are capped at {result.evidenceSnippetWordLimit} words.
        </p>
        <div className="mt-3 space-y-3">
          {evidenceItems.length > 0 ? (
            sliceImprovements(evidenceItems).map((improvement, index) => renderEvidenceCard(improvement, index))
          ) : (
            <p className="text-xs text-slate-500">No evidence-backed improvements were returned.</p>
          )}
          {renderOverflowCount(evidenceItems.length)}
        </div>
      </div>
    </div>
  );

  const renderRewritePreviewTab = () => (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setActiveDoc('resume')}
          className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase transition-all ${
            activeDoc === 'resume' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'
          }`}
        >
          Resume
        </button>
        <button
          type="button"
          onClick={() => setActiveDoc('cover')}
          className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase transition-all ${
            activeDoc === 'cover' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'
          }`}
        >
          Cover Letter
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-rose-700">Original</h4>
          <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-rose-100 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
            {selectedOriginalText.trim().length > 0 ? selectedOriginalText : 'No original text available.'}
          </pre>
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Optimized</h4>
          <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-emerald-100 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
            {hasOptimizedText ? selectedOptimizedText : 'Optimized text is not available yet.'}
          </pre>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Diff Highlights</h4>
        {changedDiffRows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {sliceDiffRows(changedDiffRows).map((row, index) => (
              <p
                key={`diff-${row.kind}-${index}`}
                className={`rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                  row.kind === 'removed'
                    ? 'border border-rose-200 bg-rose-50 text-rose-700'
                    : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                {row.kind === 'removed' ? '- ' : '+ '}
                {row.text}
              </p>
            ))}
            {renderOverflowCount(changedDiffRows.length)}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">No line-level changes detected.</p>
        )}
      </section>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-120px)] gap-6 animate-slide">
      <div className="w-1/3 overflow-y-auto pr-2 custom-scrollbar">
        <div className="space-y-5">
          <div className="glass-panel rounded-3xl p-5 shadow-sm">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">ATS Match Projection</h3>
            <p className="mt-2 text-3xl font-black text-indigo-600">
              {scoreLift === null ? 'Score unavailable' : `+${scoreLift}% Lift`}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Baseline: {baselineScore ?? 'N/A'} | Target: {enhancedScore ?? 'N/A'}
            </p>
            <p className="mt-2 text-[11px] italic text-slate-500">
              "{result.scoreBreakdown.explanation ?? 'Insufficient evidence to explain score deltas.'}"
            </p>
          </div>

          <div className="glass-panel rounded-3xl p-5 shadow-sm">
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
              {TAB_CONFIG.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-lg py-2 text-[10px] font-black uppercase transition-all ${
                    activeTab === tab.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {activeTab === 'mustFix' && renderMustFixTab()}
              {activeTab === 'atsCoverage' && renderAtsCoverageTab()}
              {activeTab === 'rewritePreview' && renderRewritePreviewTab()}
            </div>

            <details className="mt-5 border-t border-slate-100 pt-4">
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-400">
                Technical Details
              </summary>
              <div className="mt-3 space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-600">
                <p><span className="font-semibold text-slate-700">Input Hash:</span> {result.analysisTrace.inputHash}</p>
                <p><span className="font-semibold text-slate-700">Model:</span> {result.analysisTrace.modelName}</p>
                <p><span className="font-semibold text-slate-700">Tier:</span> {result.analysisTrace.tier}</p>
                <p><span className="font-semibold text-slate-700">Timestamp:</span> {result.analysisTrace.timestamp}</p>
                <p><span className="font-semibold text-slate-700">Retries:</span> {result.analysisTrace.retries}</p>
                <p>
                  <span className="font-semibold text-slate-700">Retrieval Chunks:</span>{' '}
                  {result.analysisTrace.retrievalChunkIds.length > 0
                    ? result.analysisTrace.retrievalChunkIds.join(', ')
                    : 'None'}
                </p>
              </div>
            </details>
          </div>

          <button
            onClick={onReset}
            className="w-full py-3 text-[10px] font-black uppercase text-slate-400 transition-colors hover:text-indigo-600"
          >
            &lt;- Back to New Analysis
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl glass-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
              <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm1 7h-5V8h5v1zm0 3h-5v-1h5v1zm0 3h-5v-1h5v1z" /></svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                Editing: {activeDoc === 'resume' ? 'Optimized_Resume' : 'Optimized_Cover_Letter'}
              </h2>
              <p className="text-[10px] font-medium text-slate-400">Open optimized Google Doc</p>
            </div>
          </div>
          <div className="text-right">
            <button
              onClick={handleDownloadDocx}
              disabled={!canDownloadDocx}
              className={`flex items-center rounded-xl px-6 py-2 text-xs font-black shadow-lg transition-all ${
                canDownloadDocx
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
              }`}
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download .docx
            </button>
            {!canDownloadDocx && (
              <p className="mt-1 text-[10px] text-slate-400">
                Disabled until optimized text and document are available.
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 bg-slate-200">
          {currentDocId ? (
            <iframe
              src={`https://docs.google.com/document/d/${currentDocId}/edit?rm=minimal`}
              className="h-full w-full border-none"
              title="Google Doc Editor"
              allow="autoplay"
            />
          ) : (
            <div className="flex h-full items-center justify-center italic text-slate-400">
              Optimized document is not available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultsDashboard;
