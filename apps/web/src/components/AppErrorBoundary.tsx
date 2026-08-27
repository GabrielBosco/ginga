import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

function clearVolatileUiState() {
  try {
    sessionStorage.removeItem("ginga.ui.lastOverlay");
    sessionStorage.removeItem("ginga.ui.lastModal");
  } catch {
    // Recovery must work even if storage is unavailable.
  }
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Ginga] Falha de renderizacao recuperavel", error, info.componentStack);
    try {
      window.dispatchEvent(new CustomEvent("ginga:runtime-error", {
        detail: { message: error.message, stack: error.stack || "", componentStack: info.componentStack || "" }
      }));
    } catch {
      // Telemetry is best-effort only.
    }
  }

  private recover = () => {
    clearVolatileUiState();
    this.setState({ error: null });
  };

  private reload = () => {
    clearVolatileUiState();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="runtime-recovery-screen">
        <section className="runtime-recovery-card">
          <span className="runtime-recovery-icon"><AlertTriangle size={24}/></span>
          <div>
            <span className="runtime-recovery-kicker">GINGA RECUPEROU UMA FALHA</span>
            <h1>A interface encontrou um erro.</h1>
            <p>O aplicativo nao precisa ficar em uma tela preta. Tente recuperar a interface; se o erro persistir, recarregue o Ginga.</p>
          </div>
          <code>{this.state.error.message || "Erro de renderizacao"}</code>
          <div className="runtime-recovery-actions">
            <button type="button" className="secondary-button" onClick={this.recover}><RotateCcw size={16}/> Tentar recuperar</button>
            <button type="button" className="primary-button" onClick={this.reload}><RefreshCw size={16}/> Recarregar Ginga</button>
          </div>
        </section>
      </main>
    );
  }
}
