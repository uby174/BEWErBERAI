
import React, { useMemo, useState, useEffect } from 'react';
import Header from './components/Header';
import ResultsDashboard from './components/ResultsDashboard';
import { analyzeApplication } from './services/geminiService';
import { extractTextFromDocx } from './services/documentService';
import { initGoogleApi, uploadAndConvert, requestAccessToken } from './services/googleDriveService';
import { prepareApplicationForGemini } from './services/privacyService';
import { AnalysisMode, ApplicationInput, AnalysisResult } from './types';

const ANALYSIS_MODES: { value: AnalysisMode; label: string; description: string }[] = [
  { value: 'fast', label: 'Fast', description: 'Lower cost, quicker turnaround.' },
  { value: 'balanced', label: 'Balanced', description: 'Default quality and speed balance.' },
  { value: 'deep', label: 'Deep', description: 'More thorough analysis for complex cases.' },
];

type MetricKey = keyof ApplicationInput['metricsVault'];

const METRIC_FIELDS: { key: MetricKey; label: string; placeholder: string }[] = [
  { key: 'projectImpact', label: 'Project Impact', placeholder: 'e.g., conversion +18%' },
  { key: 'latencyReduction', label: 'Latency Reduction', placeholder: 'e.g., p95 latency down 120ms' },
  { key: 'costSavings', label: 'Cost Savings', placeholder: 'e.g., cloud spend reduced $40k/year' },
  { key: 'usersServed', label: 'Users Served', placeholder: 'e.g., 2.3M monthly users' },
  { key: 'uptime', label: 'Uptime', placeholder: 'e.g., 99.95% uptime' },
  { key: 'otherMetrics', label: 'Other Metrics', placeholder: 'Any additional approved numbers' },
];

const App: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [docIds, setDocIds] = useState<{ resume?: string; cover?: string }>({});
  
  const [input, setInput] = useState<ApplicationInput>({
    jobDescription: '',
    companyInfo: '',
    resumeContent: '',
    coverLetterContent: '',
    portfolioLinks: '',
    additionalContext: '',
    analysisMode: 'balanced',
    privacyMode: true,
    metricsVault: {
      projectImpact: '',
      latencyReduction: '',
      costSavings: '',
      usersServed: '',
      uptime: '',
      otherMetrics: '',
    },
  });

  const [files, setFiles] = useState<{ resume?: File; cover?: File }>({});
  const privacyPreview = useMemo(() => {
    if (!input.privacyMode) return '';
    return prepareApplicationForGemini(input).redactedPreview;
  }, [input]);

  useEffect(() => {
    initGoogleApi().catch(console.error);
  }, []);

  const handleConnectGoogle = async () => {
    try {
      await requestAccessToken();
      setGoogleConnected(true);
    } catch (err) {
      setError('Google Drive connection failed. Please check your browser settings.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'resume' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFiles(prev => ({ ...prev, [type]: file }));
    
    try {
      // Extract text for Gemini analysis while keeping the binary for Drive
      const text = await extractTextFromDocx(file);
      if (type === 'resume') setInput(prev => ({ ...prev, resumeContent: text }));
      else setInput(prev => ({ ...prev, coverLetterContent: text }));
    } catch (err) {
      setError(`Failed to read content for AI analysis. Format preserved for editing.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.jobDescription || !input.resumeContent) {
      setError('Job Description and Resume are required.');
      return;
    }
    if (!googleConnected) {
      setError('Please connect to Google Drive to preserve document formatting.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 1. Parallel Task: Gemini Analysis & Google Drive Upload
      const [analysisResult, resumeData, coverData] = await Promise.all([
        analyzeApplication(input),
        files.resume ? uploadAndConvert(files.resume) : Promise.resolve(null),
        files.cover ? uploadAndConvert(files.cover) : Promise.resolve(null)
      ]);

      setResult(analysisResult);
      setDocIds({
        resume: resumeData?.id,
        cover: coverData?.id
      });
    } catch (err) {
      setError('Process failed. Ensure your Google Drive has space and try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const updateMetric = (key: MetricKey, value: string) => {
    setInput(prev => ({
      ...prev,
      metricsVault: {
        ...prev.metricsVault,
        [key]: value,
      },
    }));
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow max-w-7xl mx-auto px-6 py-8 w-full">
        {!result ? (
          <div className="max-w-4xl mx-auto space-y-10">
            <div className="text-center space-y-3">
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">
                High Fidelity <span className="text-indigo-600">Refinement</span>.
              </h1>
              <p className="text-slate-500 font-medium">We preserve your original .docx format using Google Docs integration.</p>
            </div>

            <div className="flex justify-center">
              {!googleConnected ? (
                <button 
                  onClick={handleConnectGoogle}
                  className="px-8 py-4 bg-white border border-slate-200 shadow-sm rounded-2xl flex items-center gap-3 hover:shadow-md transition-all active:scale-95 group"
                >
                  <img src="https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png" className="w-6 h-6" alt="Drive" />
                  <span className="text-sm font-bold text-slate-700">Connect Google Drive to Preserve Formatting</span>
                </button>
              ) : (
                <div className="px-6 py-3 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold flex items-center gap-2 border border-emerald-100">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  Google Drive Connected
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="glass-panel p-4 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Analysis Mode
                  </label>
                  <label className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      checked={input.privacyMode}
                      onChange={(e) => setInput(prev => ({ ...prev, privacyMode: e.target.checked }))}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Privacy Mode
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {ANALYSIS_MODES.map((mode) => {
                    const active = input.analysisMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setInput((prev) => ({ ...prev, analysisMode: mode.value }))}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          active
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-xs font-black uppercase tracking-widest">{mode.label}</p>
                        <p className="text-[10px] mt-1 leading-relaxed">{mode.description}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 text-[10px] text-slate-500 space-y-1">
                  <p>
                    {input.privacyMode
                      ? 'PII redaction is ON: email, phone, street address, full birth date, and personal IDs are masked before Gemini.'
                      : 'PII redaction is OFF: your raw text is sent to Gemini.'}
                  </p>
                  <p>
                    City/country and role history remain intact so ATS matching still works.
                  </p>
                </div>
                {input.privacyMode && (
                  <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                    <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Preview: Redacted Payload Sent to Gemini
                    </summary>
                    <pre className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 max-h-64 overflow-auto">
                      {privacyPreview}
                    </pre>
                  </details>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 {/* Step 1: Context */}
                 <div className={`space-y-6 transition-opacity ${activeStep === 2 ? 'opacity-30 pointer-events-none' : ''}`}>
                    <div className="glass-panel p-6 rounded-3xl shadow-sm space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Job Description</label>
                      <textarea
                        required
                        value={input.jobDescription}
                        onChange={(e) => setInput({ ...input, jobDescription: e.target.value })}
                        placeholder="Paste full JD text here..."
                        className="w-full h-48 p-4 rounded-2xl bg-[#f8fafc] border-none focus:ring-2 ring-indigo-500 text-sm outline-none resize-none"
                      />
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block pt-2">Company Values / Tech Info</label>
                      <textarea
                        value={input.companyInfo}
                        onChange={(e) => setInput({ ...input, companyInfo: e.target.value })}
                        placeholder="Culture info, mission statements..."
                        className="w-full h-24 p-4 rounded-2xl bg-[#f8fafc] border-none focus:ring-2 ring-indigo-500 text-sm outline-none resize-none italic"
                      />
                    </div>
                 </div>

                 {/* Step 2: Assets */}
                 <div className={`space-y-6 transition-opacity ${activeStep === 1 ? 'opacity-30 pointer-events-none' : ''}`}>
                    <div className="glass-panel p-6 rounded-3xl shadow-sm space-y-6">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Your Resume (.docx)</label>
                        <input type="file" accept=".docx" onChange={e => handleFileUpload(e, 'resume')} className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-6 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Cover Letter (.docx)</label>
                        <input type="file" accept=".docx" onChange={e => handleFileUpload(e, 'cover')} className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-6 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Portfolio Link</label>
                        <input
                          type="text"
                          value={input.portfolioLinks}
                          onChange={(e) => setInput({ ...input, portfolioLinks: e.target.value })}
                          placeholder="github.com/..."
                          className="w-full mt-2 p-4 rounded-xl bg-[#f8fafc] border-none text-sm focus:ring-2 ring-indigo-500"
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                          Metrics Vault (Optional Approved Numbers)
                        </label>
                        <div className="grid grid-cols-1 gap-3">
                          {METRIC_FIELDS.map((field) => (
                            <input
                              key={field.key}
                              type="text"
                              value={input.metricsVault[field.key] ?? ''}
                              onChange={(e) => updateMetric(field.key, e.target.value)}
                              placeholder={field.placeholder}
                              className="w-full p-3 rounded-xl bg-[#f8fafc] border-none text-sm focus:ring-2 ring-indigo-500"
                              aria-label={field.label}
                            />
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-400">
                          The rewrite step can only use numeric values from this vault.
                        </p>
                      </div>
                    </div>
                 </div>
              </div>

              <div className="flex justify-between items-center">
                 <button 
                  type="button" 
                  onClick={() => setActiveStep(activeStep === 1 ? 2 : 1)}
                  className="text-[10px] font-black uppercase text-slate-400 hover:text-indigo-600 tracking-widest transition-colors"
                 >
                  {activeStep === 1 ? 'Go to Document Upload →' : '← Back to Job Details'}
                 </button>
                 
                 <button
                    type="submit"
                    disabled={loading || !googleConnected}
                    className={`px-12 py-5 rounded-3xl font-black text-lg shadow-2xl transition-all ${
                      loading || !googleConnected ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-black active:scale-95'
                    }`}
                  >
                    {loading ? 'Refining & Syncing Drive...' : 'Apply Optimization'}
                  </button>
              </div>

              {error && <div className="p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-xs text-center font-bold">{error}</div>}
            </form>
          </div>
        ) : (
          <ResultsDashboard
            result={result}
            docIds={docIds}
            originalDocs={{
              resume: input.resumeContent,
              cover: input.coverLetterContent,
            }}
            onReset={() => setResult(null)}
          />
        )}
      </main>

      <footer className="py-8 text-center text-[10px] font-bold text-slate-300 uppercase tracking-[0.3em]">
        © 2025 BewerberAI • High Fidelity Market Ready
      </footer>
    </div>
  );
};

export default App;
