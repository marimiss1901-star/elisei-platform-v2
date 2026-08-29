import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error:null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ELISEI UI render failed', error, info)
  }

  reset = () => {
    this.setState({ error:null })
    if (window.location.pathname !== '/app') window.history.pushState({}, '', '/app')
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="app-crash-shell">
      <section className="app-crash-card">
        <div className="brand-mark">E</div>
        <span>ELISEI восстановил интерфейс</span>
        <h1>Экран не должен пропадать целиком</h1>
        <p>Один блок не отрисовался, поэтому я остановил падение сайта. Данные кабинета сохранены, можно вернуться в приложение и продолжить работу.</p>
        <button type="button" className="primary-btn" onClick={this.reset}>Вернуться в кабинет</button>
        <small>{this.state.error?.message || 'Ошибка интерфейса уже записана в консоль браузера.'}</small>
      </section>
    </main>
  }
}
