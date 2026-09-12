import { useEffect, useRef, useState } from 'react';
import { contentCardSchema } from '@edi/contracts';
import './content.css';

function LocalVideo({ caption }: { caption: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const player = useRef<HTMLVideoElement>(null);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    const pause = () => {
      if (document.hidden) player.current?.pause();
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  return (
    <figure className="local-video">
      <figcaption>{caption}</figcaption>
      {url && (
        <video
          ref={player}
          key={url}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={() => setError('This video could not be played. Try an MP4 or WebM file.')}
        />
      )}
      <label className="video-picker">
        {url ? 'Choose another video' : 'Choose a video'}
        <input
          aria-label="Choose a local video"
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
              setError('Choose an MP4, WebM, or MOV video.');
              return;
            }
            setError('');
            setUrl(URL.createObjectURL(file));
          }}
        />
      </label>
      <p className="ds-footnote ds-tertiary">Stays on your Mac. Nothing is uploaded.</p>
      {error && (
        <p role="alert" className="content-error">
          {error}
        </p>
      )}
    </figure>
  );
}

/** Renders a validated content document. Unknown or invalid data never reaches the DOM. */
export function CardContent({ data }: { data: unknown }) {
  const parsed = contentCardSchema.safeParse(data);
  if (!parsed.success) return <p role="alert">Edi couldn’t display this content.</p>;
  return (
    <section className="response-view">
      <h1 className="ds-title">{parsed.data.title}</h1>
      {parsed.data.blocks.map((block, index) => {
        switch (block.type) {
          case 'text':
            return (
              <p className="content-paragraph" key={index}>
                {block.text}
              </p>
            );
          case 'steps':
            return (
              <ol className="content-steps" key={index}>
                {block.labels.map((label, step) => (
                  <li key={step}>
                    <span>{step + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
            );
          case 'local-video':
            return <LocalVideo key={index} caption={block.caption} />;
        }
      })}
    </section>
  );
}
