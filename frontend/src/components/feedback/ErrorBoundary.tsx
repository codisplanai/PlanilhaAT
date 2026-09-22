import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';

interface Props {
  children: ReactNode;
  /**
   * Muda a cada navegação. Sem isso, uma falha em uma tela mantinha a tela de
   * erro visível em todas as rotas seguintes, já que o boundary envolve o
   * roteador inteiro e nada reabilitava a renderização dos filhos.
   */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    resetKey: undefined,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, error: null, resetKey: props.resetKey };
    }
    return null;
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="min-h-[50vh] flex items-center justify-center p-6"
        >
          <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xl p-6 sm:p-8 max-w-md w-full text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto shadow-2xs">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Falha ao carregar a página
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Ocorreu uma instabilidade na renderização ou no carregamento dos recursos desta tela.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={this.handleReset}
              >
                Tentar Novamente
              </Button>
              <Button
                size="sm"
                onClick={this.handleReload}
                leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              >
                Recarregar Sistema
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
