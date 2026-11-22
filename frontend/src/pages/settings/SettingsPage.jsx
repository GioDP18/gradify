import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, School, SlidersHorizontal, UserCog, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/common/Toast';
import * as authApi from '../../services/authApi';
import './settings.css';

/** On/off switch that saves at once. */
function SettingSwitch({ label, description, checked, onChange, disabled }) {
  const id = useId();
  return (
    <div className="evsu-setting">
      <div className="evsu-setting__text">
        <label htmlFor={id} className="evsu-setting__label">{label}</label>
        <div id={`${id}-desc`} className="evsu-setting__desc">{description}</div>
      </div>
      <div className="form-check form-switch evsu-setting__switch">
        <input id={id} type="checkbox" role="switch" className="form-check-input" checked={checked} disabled={disabled}
          aria-describedby={`${id}-desc`} onChange={(e) => onChange(e.target.checked)} />
      </div>
    </div>
  );
}

/** A section of Settings; opens on its own page. */
function LinkRow({ to, icon: Icon, title, description }) {
  return (
    <Link to={to} className="evsu-setting evsu-setting--link">
      <span className="evsu-setting__icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="evsu-setting__text">
        <span className="evsu-setting__label">{title}</span>
        <span className="evsu-setting__desc">{description}</span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="text-muted-evsu" />
    </Link>
  );
}

/** Every section, per role (the administrator has no classes, so no General section). */
function sectionsFor(role) {
  const shared = [
    { to: '/settings/grading', icon: SlidersHorizontal, title: 'Grading criteria',
      description: role === 'ADMIN' ? 'Weights per grading period and component for every class, and their version history.' : 'The weights every class is graded with (set by the administrator), and their version history.' },
    { to: '/settings/profile', icon: UserRound, title: 'My profile', description: 'Your name, email, username, password, and profile photo.' },
  ];
  return role === 'ADMIN'
    ? [{ to: '/settings/users', icon: UserCog, title: 'Instructor accounts', description: 'Create instructor accounts, disable or re-enable them, and set new passwords.' }, ...shared]
    : shared;
}

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const workingClass = user?.preferences?.workingClass ?? true;

  const setWorkingClass = async (on) => {
    setSaving(true);
    const previous = user;
    updateUser({ ...user, preferences: { ...user.preferences, workingClass: on } }); // switch moves at once
    try {
      updateUser(await authApi.updatePreferences({ workingClass: on }));
      toast.success(on ? 'Working class turned on.' : 'Working class turned off. Each page now has its own class selector.');
    } catch (error) {
      updateUser(previous);
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="evsu-settings">
      {!isAdmin && (
      <section className="evsu-card p-4 p-md-5" aria-labelledby="settings-classes">
        <div className="evsu-settings__head">
          <span className="evsu-setting__icon" aria-hidden="true"><School size={18} /></span>
          <div>
            <h2 id="settings-classes" className="h5 mb-1">Classes</h2>
            <p className="small text-muted-evsu mb-0">How the class pages choose which class to show.</p>
          </div>
        </div>
        <SettingSwitch
          label="Use a working class"
          checked={workingClass}
          disabled={saving}
          onChange={setWorkingClass}
          description={workingClass ? (
            <>On: you pick one class with <strong>Work in this class</strong> on the Classes page (or the dashboard filter), and Students, Attendance, Written Quizzes, Performance Activities, Examinations, and Grading all show that class.</>
          ) : (
            <>Off: each of those pages has its own <strong>Class</strong> selector and remembers its own choice, so for example Attendance and Grading can show different classes.</>
          )}
        />
      </section>
      )}

      <section className="evsu-card p-4 p-md-5" aria-labelledby="settings-more">
        <h2 id="settings-more" className="h5 mb-3">{isAdmin ? 'Settings' : 'More settings'}</h2>
        <div className="evsu-settings__links">
          {sectionsFor(user?.role).map((section) => <LinkRow key={section.to} {...section} />)}
        </div>
      </section>
    </div>
  );
}
