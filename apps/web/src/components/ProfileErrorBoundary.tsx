import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props { children: ReactNode; onClose: () => void; }
interface State { failed: boolean; message: string; }

export class ProfileErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, message: error instanceof Error ? error.message : "Falha inesperada ao abrir o perfil" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Falha isolada no perfil do usuario", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="modal-backdrop profile-error-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) this.props.onClose(); }}>
        <section className="modal-card modal-sm profile-error-card" role="alertdialog" aria-label="Falha ao abrir perfil">
          <button className="profile-error-close" type="button" onClick={this.props.onClose} aria-label="Fechar"><X size={18}/></button>
          <AlertTriangle size={28}/>
          <h2>Nao foi possivel abrir este perfil</h2>
          <p>O Ginga isolou o erro para nao derrubar a interface inteira.</p>
          <small>{this.state.message}</small>
          <button type="button" className="primary-button" onClick={this.props.onClose}>Voltar ao Ginga</button>
        </section>
      </div>
    );
  }
}
