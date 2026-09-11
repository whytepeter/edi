import { useEffect, useRef, useState } from 'react';
import { contentCardSchema, type ContentCard } from '@edi/contracts';

function LocalVideo({ caption }: { caption: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    const pause = () => { if (document.hidden) player.current?.pause(); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  return <figure className="local-video">
    <figcaption>{caption}</figcaption>
    {url && <video ref={player} key={url} src={url} controls playsInline preload="metadata"
      onError={() => setError('This video could not be played. Try an MP4 or WebM file.')} />}
    <label className="video-picker">{url ? 'Choose another video' : 'Choose a video'}
      <input aria-label="Choose a local video" type="file" accept="video/mp4,video/webm,video/quicktime" onChange={event => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
          setError('Choose an MP4, WebM, or MOV video.'); return;
        }
        setError(''); setUrl(URL.createObjectURL(file));
      }} />
    </label>
    <p className="fine-print">Stays on your Mac. Nothing is uploaded.</p>
    {error && <p role="alert">{error}</p>}
  </figure>;
}

export function CardContent({ data }: { data: unknown }) {
  const parsed = contentCardSchema.safeParse(data);
  if (!parsed.success) return <p role="alert">Edi couldn’t display this content.</p>;
  return <section className="response-view"><h1>{parsed.data.title}</h1>
    {parsed.data.blocks.map((block, index) => {
      switch (block.type) {
        case 'text': return <p className="content-paragraph" key={index}>{block.text}</p>;
        case 'steps': return <ol className="content-steps" key={index}>{block.labels.map((label, step) =>
          <li key={step}><span>{step + 1}</span>{label}</li>)}</ol>;
        case 'local-video': return <LocalVideo key={index} caption={block.caption}/>;
      }
    })}
  </section>;
}

const examples: Record<string, ContentCard> = {
  Illustration: { version: 1, title: 'From a spark to something real.', blocks: [
    { type: 'text', text: 'Ideas get easier to work with when you can see how the pieces connect.' },
    { type: 'steps', labels: ['Imagine', 'Explore', 'Make'] },
  ] },
  Text: { version: 1, title: 'Room for a thought.', blocks: [
    { type: 'text', text: 'A short answer belongs in a small card. Longer explanations can expand without taking you away from what you were doing.' },
    { type: 'text', text: 'This is sample content, not an agent response.' },
  ] },
  Video: { version: 1, title: 'A little room to watch.', blocks: [
    { type: 'local-video', caption: 'Preview a video from your Mac.' },
  ] },
};

export function ContentPreview({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState('Illustration');
  return <div><div className="filters" aria-label="Content previews">
    {Object.keys(examples).map(name => <button key={name} aria-pressed={selected === name}
      className={selected === name ? 'selected' : ''} onClick={() => setSelected(name)}>{name}</button>)}
    </div><CardContent key={selected} data={examples[selected]}/>
    <button className="text-button" onClick={onBack}>Back to preview</button>
    <span className="preview-label">SAMPLE CONTENT · NO MODEL CONNECTED</span>
  </div>;
}
