import { useState } from 'react';
import {
  IconButton,
  List,
  ListRow,
  SegmentedControl,
  TextField,
  type IconName,
} from '../../components/ui';

const kinds = ['All', 'Skills', 'Connectors', 'MCP', 'Skins'] as const;
type Kind = (typeof kinds)[number];

interface CatalogItem {
  name: string;
  kind: Exclude<Kind, 'All'>;
  icon: IconName;
  detail: string;
  available?: boolean;
}

// Preview catalog. External installs are not implemented yet.
const catalog: CatalogItem[] = [
  {
    name: 'Cloud & Sprout',
    kind: 'Skins',
    icon: 'face',
    detail: 'Two faces. One Edi.',
    available: true,
  },
  {
    name: 'Meeting notes',
    kind: 'Skills',
    icon: 'notes',
    detail: 'A little help keeping the important bits.',
  },
  {
    name: 'Your calendar',
    kind: 'Connectors',
    icon: 'calendar',
    detail: 'Bring your day into the conversation.',
  },
  { name: 'MCP servers', kind: 'MCP', icon: 'plug', detail: 'Connect tools from your world.' },
];

export function ExtensionsView({ onOpenAppearance }: { onOpenAppearance(): void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('All');
  const needle = query.trim().toLowerCase();
  const items = catalog.filter(
    item =>
      (kind === 'All' || item.kind === kind) &&
      `${item.name} ${item.detail}`.toLowerCase().includes(needle),
  );
  return (
    <section>
      <header className="view-header">
        <p className="ds-eyebrow">Extensions</p>
        <h1 className="ds-large-title">A few more possibilities.</h1>
      </header>
      <div className="extensions-controls">
        <TextField
          label="Search extensions"
          hideLabel
          icon="search"
          type="search"
          placeholder="Find something for Edi"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <SegmentedControl<Kind>
          label="Extension type"
          options={kinds}
          value={kind}
          onChange={setKind}
        />
      </div>
      <List label="Extensions">
        {items.map(item => (
          <ListRow
            key={item.name}
            icon={item.icon}
            title={item.name}
            subtitle={item.detail}
            meta={item.available ? 'Included' : 'Coming later · not connected'}
            trailing={
              item.available && (
                <IconButton
                  icon="arrow-up-right"
                  label="Choose an avatar"
                  onClick={onOpenAppearance}
                />
              )
            }
          />
        ))}
      </List>
      {items.length === 0 && (
        <p className="view-footnote ds-footnote ds-tertiary">No matches. Try another search.</p>
      )}
      <p className="view-footnote ds-footnote ds-tertiary">
        Catalog preview. External installs are not enabled yet.
      </p>
    </section>
  );
}
