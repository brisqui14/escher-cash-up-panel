import type { CloseoutClient, CloseoutSnapshot } from "./contracts";

export interface CashUpPanelProps {
  client: CloseoutClient;
  onFinalized: (snapshot: CloseoutSnapshot) => void;
}

export function CashUpPanel(_props: CashUpPanelProps) {
  return (
    <section className="cash-up-panel" aria-labelledby="cash-up-heading">
      <h2 id="cash-up-heading">Cash up this counter</h2>
      <p>This is the candidate implementation area.</p>
      <p>
        Use the supplied client to load the drawer, save a draft, and finalize
        the closeout. See the brief for behavior and scope.
      </p>
    </section>
  );
}
