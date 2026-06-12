import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-50 text-red-900 border border-red-200 rounded-lg m-4 font-mono text-sm shadow-md">
          <h2 className="text-xl font-bold mb-4">Error de Renderizado (White Screen atrapada)</h2>
          <p className="mb-2 font-bold">{this.state.error && this.state.error.message}</p>
          <details style={{ whiteSpace: 'pre-wrap' }} className="bg-white p-4 rounded border border-red-100 overflow-auto max-h-96 text-xs">
            {this.state.errorInfo?.componentStack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
