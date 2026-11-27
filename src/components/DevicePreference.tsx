import { useId, type ChangeEventHandler } from 'react';
import styles from './SettingsPage.module.css';

interface Props {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

export default function DevicePreference({ title, description, ...checkbox }: Props) {
  const id = useId();
  return <label className={styles.preference}>
    <span id={id}>{title}</span>
    <input type="checkbox" aria-labelledby={id} aria-describedby={id + '-description'} {...checkbox} />
    <small id={id + '-description'}>{description}</small>
  </label>;
}
