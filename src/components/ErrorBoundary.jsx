import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('LingoFlow page error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm rounded-3xl bg-white border border-rose-100 p-6 text-center shadow-sm">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center"><AlertTriangle className="w-6 h-6" /></span>
          <h2 className="mt-4 text-lg font-bold text-slate-900">这个页面刚刚卡住了</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">你的本地学习数据没有被清除。刷新应用后可以继续使用。</p>
          <button onClick={() => window.location.reload()} className="mt-5 w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-semibold flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4" />重新加载</button>
        </div>
      </div>
    );
  }
}
