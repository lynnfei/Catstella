(() => {
  const viewers = [...document.querySelectorAll('catstella-usage-viewer')];
  const syncAgy = document.querySelector('#sync-agy');
  const palette = document.querySelector('#palette');
  const scenario = document.querySelector('#scenario');
  const hour = 60 * 60 * 1000;
  let referenceTime = Date.now();
  const normalStatus = () => syncAgy.checked ? '样例数据 · Web 与 AGY 分开计量' : '样例数据 · 仅显示 Gemini 网页用量';
  let status = normalStatus();
  let refreshing = false;

  function sampleGroups() {
    const t = referenceTime;
    const demo = scenario.value;
    const web = { name: 'Gemini 网页版', rows: [
      { label: '5 小时限额', remaining: 81, resetAt: t + 2.5 * hour },
      { label: '每周限额', remaining: 54, resetAt: t + 92 * hour },
    ] };
    const agy = { name: 'Gemini 模型 · AGY', rows: [
      { label: '每周限额', remaining: 53, resetAt: t + 90 * hour },
      { label: '5 小时限额', remaining: 100, resetAt: t + 4.68 * hour },
      { label: 'Argon 每周限额', remaining: 9, resetAt: t + 137 * hour },
    ] };
    if (demo === 'low') {
      web.rows[0].remaining = 0;
      web.rows[1].remaining = 18;
      agy.rows[1].remaining = 7;
    }
    if (demo === 'expiry') {
      for (const group of [web, agy]) {
        const row = group.rows.find(r => r.label === '5 小时限额');
        Object.assign(row, { remaining: 0, resetAt: t + 5000 });
      }
    }
    if (demo === 'unavailable') {
      for (const group of [web, agy]) {
        group.rows = group.rows.map(({ label }) => ({ label }));
      }
    }
    return syncAgy.checked ? [web, agy] : [web];
  }

  function render() {
    const data = { groups: sampleGroups(), status, refreshing };
    for (const viewer of viewers) viewer.data = data;
  }

  palette.addEventListener('change', () => {
    document.documentElement.dataset.kiminoPalette = palette.value;
  });
  syncAgy.addEventListener('change', () => {
    if (scenario.value === 'normal' && !refreshing) status = normalStatus();
    render();
  });
  scenario.addEventListener('change', () => {
    referenceTime = Date.now();
    status = scenario.value === 'expiry' ? '5 秒后到达重置时间 · 归零不代表额度已恢复'
      : scenario.value === 'unavailable' ? '未获取到用量 · 不用 0% 代替缺失数据'
      : normalStatus();
    render();
  });
  document.addEventListener('usage-refresh', () => {
    if (refreshing) return;
    refreshing = true;
    status = '正在读取样例用量…';
    render();
    setTimeout(() => {
      refreshing = false;
      if (scenario.value === 'expiry') scenario.value = 'normal';
      referenceTime = Date.now();
      status = scenario.value === 'unavailable' ? '样例刷新未取得用量' : '样例用量已更新';
      render();
    }, 500);
  });
  render();
})();
