import AgendaLoader from './agenda-loader';

export default function Page() {
  return (
    <>
      <div className="wrap" id="app">
        <div className="empty"><h2>Cargando agenda…</h2></div>
      </div>
      <div id="modal"></div>
      <div id="dialog"></div>
      <div id="toast" role="status" aria-live="polite"></div>
      <AgendaLoader />
    </>
  );
}
