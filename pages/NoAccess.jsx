import { useAuth } from '../lib/auth';

export default function NoAccess() {
  const { profile, signOut, reloadProfile } = useAuth();
  const inactive = profile && !profile.active;
  return (
    <div className="login">
      <div className="login-card">
        <span className="brand-bars big" aria-hidden="true"><i /><i /><i /></span>
        <h1>{inactive ? 'Access switched off' : 'Almost there'}</h1>
        <p>
          {inactive
            ? 'Your access to Cheque Collection has been turned off. Ask finance if this is a mistake.'
            : `You're signed in as ${profile?.email ?? 'a new user'}, but finance hasn't given you a role yet. Ask them to set you up as sales, driver or finance, then check again.`}
        </p>
        <div className="row">
          <button className="btn primary" onClick={reloadProfile}>Check again</button>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
        <div className="lh-band"><strong>Oceanpick Private Limited</strong>No 532/4F, Sirikotha Lane, Colombo 03, Sri Lanka · +94 112 689 099</div>
      </div>
    </div>
  );
}
