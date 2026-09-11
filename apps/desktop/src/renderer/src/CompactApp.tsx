import { useEffect, useState, type CSSProperties } from 'react';
import { defaultSettings, skins, type DesktopBridge, type Settings, type SkinId } from '@edi/contracts';
import { Pet } from './Pet';
import { AgentPanel } from './AgentPanel';
import { DesktopPet } from './DesktopPet';

declare global { interface Window { edi?: DesktopBridge } }
type View = 'content' | 'avatars' | 'extensions' | 'activity' | 'agent';
type IconName = 'expand' | 'collapse' | 'close' | 'more' | 'back' | 'pin' | 'check' | 'plus';
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    expand: 'M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6',
    collapse: 'M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6',
    close: 'M6 6l12 12M18 6L6 18', back: 'M14 5l-7 7 7 7',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    pin: 'M9 3h6l-1 7 4 4v2H6v-2l4-4-1-7M12 16v5',
    check: 'M5 12l4 4L19 6', plus: 'M12 5v14M5 12h14',
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 4 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [view, setView] = useState<View>('content');
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [preview, setPreview] = useState<SkinId>('cloud');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const petSurface = new URLSearchParams(location.search).get('surface') === 'pet';
  useEffect(() => {
    document.body.classList.toggle('pet-surface', petSurface);
    if (!window.edi) return;
    window.edi.settings().then(value => { setSettings(value); setPreview(value.skin); }).catch(() => setError('Could not load your preferences.'));
    return window.edi.onSettings(setSettings);
  }, [petSurface]);
  async function send(command: Parameters<DesktopBridge['command']>[0]) {
    try {
      if (window.edi) await window.edi.command(command);
      else if (command.type === 'apply-skin') setSettings(s => ({ ...s, skin: command.skin }));
      else if (command.type === 'set-pinned') setSettings(s => ({ ...s, pinned: command.pinned }));
      return true;
    } catch { setError('Couldn’t make that change. Try again.'); return false; }
  }
  useEffect(() => {
    if (petSurface) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (menu) setMenu(false);
        else void send({ type: 'hide-workspace' });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [menu, petSurface]);
  const accent = skins.find(s => s.id === settings.skin)!.color;
  if (petSurface) return <DesktopPet skin={settings.skin} color={accent}/>;
  function navigate(next: View) { setView(next); setMenu(false); setPreview(settings.skin); }
  const items = [
    { name: 'Cloud & Sprout', kind: 'Skins', symbol: '☺', detail: 'Two faces. One Edi.', available: true },
    { name: 'Meeting notes', kind: 'Skills', symbol: '≡', detail: 'A little help keeping the important bits.' },
    { name: 'Your calendar', kind: 'Connectors', symbol: '▦', detail: 'Bring your day into the conversation.' },
    { name: 'MCP servers', kind: 'MCP', symbol: '⌘', detail: 'Connect tools from your world.' },
  ].filter(item => (filter === 'All' || item.kind === filter) && `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={`card ${expanded ? 'expanded' : ''}`} style={{ '--accent': accent } as CSSProperties}>
    <header className="card-header"><div className="identity">{view !== 'content' ? <button className="icon-button" aria-label="Back to content" onClick={() => navigate('content')}><Icon name="back"/></button> : <span className="mini-avatar"><Pet skin={settings.skin}/></span>}<span>edi<span className="identity-dot"/></span></div><div className="header-actions"><button className={`icon-button ${settings.pinned ? 'is-on' : ''}`} aria-label={settings.pinned ? 'Unpin card' : 'Pin card'} aria-pressed={settings.pinned} onClick={() => void send({ type: 'set-pinned', pinned: !settings.pinned })}><Icon name="pin"/></button><button className="icon-button" aria-label={expanded ? 'Collapse card' : 'Expand card'} aria-expanded={expanded} onClick={async () => { if (await send({ type: 'set-expanded', expanded: !expanded })) setExpanded(!expanded); }}><Icon name={expanded ? 'collapse' : 'expand'}/></button><button className="icon-button" aria-label="More options" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more"/></button><button className="icon-button" aria-label="Dismiss card" onClick={() => void send({ type: 'hide-workspace' })}><Icon name="close"/></button></div></header>
    {menu && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenu(false)}/><div className="options"><button onClick={() => navigate('agent')}>Talk to Edi <span>↗</span></button><button onClick={() => navigate('avatars')}>Appearance <span>☺</span></button><button onClick={() => navigate('extensions')}>Extensions <span>✧</span></button><button onClick={() => navigate('activity')}>Activity <span>◷</span></button></div></>}
    <main className="card-content">{error && <div role="alert" className="error">{error}</div>}
      {view === 'agent' && <AgentPanel/>}
      {view === 'content' && <section className="intro-view"><div className="hello-visual"><div className="halo"/><Pet skin={settings.skin}/><span className="hello-note">hey, you.</span></div><h1>A little space.<br/>Just when you need it.</h1><p>Edi’s explanations, media, and questions<br/>will appear here as you talk.</p><button className="preview-button" onClick={() => navigate('agent')}>Talk to Edi <span>↗</span></button><span className="preview-label">TEMPORARY CONNECTION TEST</span></section>}
      {view === 'avatars' && <section><div className="eyebrow">APPEARANCE</div><h1>Pick your little someone.</h1><p className="subtitle">Same Edi. A different face.</p><div className="avatar-grid">{skins.map(skin => <button key={skin.id} className={`avatar-choice ${preview === skin.id ? 'selected' : ''}`} aria-label={`${skin.name} avatar option`} aria-pressed={preview === skin.id} onClick={() => setPreview(skin.id)}><Pet skin={skin.id}/><span>{skin.name}</span><small>{settings.skin === skin.id ? 'Your Edi' : 'Try a new look'}</small>{preview === skin.id && <i><Icon name="check"/></i>}</button>)}</div><button className="primary-button" disabled={preview === settings.skin} onClick={() => void send({ type: 'apply-skin', skin: preview })}>{preview === settings.skin ? 'This is your Edi' : `Use ${skins.find(s => s.id === preview)!.name}`}</button><p className="fine-print">Your voice and conversations stay the same.</p></section>}
      {view === 'extensions' && <section><div className="eyebrow">EXTENSIONS</div><h1>A few more possibilities.</h1><input className="search" aria-label="Search extensions" placeholder="Find something for Edi" value={query} onChange={event => setQuery(event.target.value)}/><div className="filters">{['All', 'Skills', 'Connectors', 'MCP', 'Skins'].map(kind => <button key={kind} aria-pressed={filter === kind} className={filter === kind ? 'selected' : ''} onClick={() => setFilter(kind)}>{kind}</button>)}</div><div className="extension-list">{items.map(item => <article key={item.name}><span className="extension-symbol">{item.symbol}</span><div><h2>{item.name}</h2><p>{item.detail}</p><small>{item.available ? 'Included' : 'Coming later · not connected'}</small></div>{item.available && <button className="icon-button" aria-label="Choose an avatar" onClick={() => navigate('avatars')}>↗</button>}</article>)}{items.length === 0 && <p className="fine-print">No matches. Try another search.</p>}</div><p className="fine-print">Catalog preview. External installs are not enabled yet.</p></section>}
      {view === 'activity' && <section><div className="eyebrow">ACTIVITY</div><div className="quiet"><span>◷</span><h1>A quiet beginning.</h1><p>When Edi starts helping, actions<br/>and approvals will appear here.</p></div></section>}
    </main><footer className="card-footer"><span className="ready-dot"/><span>Here when you need me</span><kbd>⌘ ⇧ E</kbd></footer>
  </div>;
}
