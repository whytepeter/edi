import { accentFor } from '../../lib/bridge';
import { useSettings } from '../../hooks/useSettings';
import { DesktopPet } from './DesktopPet';
import './pet.css';

/** The always-on-top character window. */
export function PetSurface() {
  const { settings } = useSettings();
  return <DesktopPet skin={settings.skin} color={accentFor(settings.skin)} />;
}
