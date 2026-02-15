
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
            BewerberAI
          </span>
        </div>
        <nav className="hidden md:flex space-x-8 text-sm font-medium text-slate-500">
          <a href="#" className="text-indigo-600">Optimizer</a>
          <a href="#" className="hover:text-slate-900 transition-colors">Career Path</a>
          <a href="#" className="hover:text-slate-900 transition-colors">DACH Market Insights</a>
        </nav>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-semibold px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full">EN/DE Mode</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
