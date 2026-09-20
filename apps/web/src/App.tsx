export function App() {
  return (
    <main className="page">
      <section className="card" aria-labelledby="page-title">
        <div className="badge" aria-hidden="true">🔕</div>
        <p className="eyebrow">MAX Mini-app</p>
        <h1 id="page-title">Тихий Чат</h1>
        <p className="description">
          Профиль жильца и персональные алерты будут подключены на этапе 2.
        </p>
        <div className="status" role="status">Каркас Mini-app работает</div>
      </section>
    </main>
  );
}
