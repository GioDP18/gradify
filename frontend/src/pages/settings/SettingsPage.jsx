import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ChevronRight, School, SlidersHorizontal, UserCog, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/common/Toast';
import * as authApi from '../../services/authApi';
import { useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const workingClass = user?.preferences?.workingClass ?? true;

  const chatHistory = user?.preferences?.chatHistory ?? true;

  /** Saves one on/off setting at once; the switch moves immediately and goes back if saving fails. */
  const setPreference = async (name, on, saved) => {
    setSaving(true);
    const previous = user;
    updateUser({ ...user, preferences: { ...user.preferences, [name]: on } });
    try {
      updateUser(await authApi.updatePreferences({ [name]: on }));
      toast.success(saved);
      return true;
    } catch (error) {
      updateUser(previous);
      toast.error(error.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setWorkingClass = (on) => setPreference('workingClass', on, on ? 'Working class turned on.' : 'Working class turned off. Each page now has its own class selector.');

  const setChatHistory = async (on) => {
    const done = await setPreference('chatHistory', on, on ? 'Chat history turned on.' : 'Chat history turned off. Your saved chats are kept.');
    if (done) queryClient.removeQueries({ queryKey: ['assistant-chats'] }); // read the list again the next time the Chat page shows it
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

      <section className="evsu-card p-4 p-md-5" aria-labelledby="settings-assistant">
        <div className="evsu-settings__head">
          <span className="evsu-setting__icon" aria-hidden="true"><Bot size={18} /></span>
          <div>
            <h2 id="settings-assistant" className="h5 mb-1">Assistant</h2>
            <p className="small text-muted-evsu mb-0">What the Chat page remembers.</p>
          </div>
        </div>
        <SettingSwitch
          label="Keep chat history"
          checked={chatHistory}
          disabled={saving}
          onChange={setChatHistory}
          description={chatHistory ? (
            <>On: your chats with the assistant are saved to your account, so the history is there on any device or browser you sign in on. You can delete a chat from the Chat page.</>
          ) : (
            <>Off: new conversations are not saved, and one is gone as soon as you leave the Chat page. The chats you already saved are kept and come back when you turn this on again. To remove one, delete it from the Chat page.</>
          )}
        />
      </section>

      <section className="evsu-card p-4 p-md-5" aria-labelledby="settings-more">
        <h2 id="settings-more" className="h5 mb-3">{isAdmin ? 'Settings' : 'More settings'}</h2>
        <div className="evsu-settings__links">
          {sectionsFor(user?.role).map((section) => <LinkRow key={section.to} {...section} />)}
        </div>
      </section>
    </div>
  );
}
