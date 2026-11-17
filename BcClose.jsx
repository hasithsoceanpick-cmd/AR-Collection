import { useOutletContext } from 'react-router-dom';
import CloseMonth from '../components/CloseMonth';
import { MatchBc } from '../components/DocNumbers';

// Business Central, step 3: close a month whose bank reconciliations are done; line both number series up with BC.
export default function BcClose() {
  const { reloadToday } = useOutletContext() ?? {};
  return (
    <section className="wide">
      <div className="page-head"><h1>Close the month</h1></div>
      <CloseMonth onDone={reloadToday} defaultOpen />
      <MatchBc onDone={reloadToday} />
    </section>
  );
}
