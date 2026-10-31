// "Acceptér modbud" – også når modbuddet er over transferbudgettet (forklaring + mulighed for at flytte penge).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { act } from '../game/actions';
import { SHIFT_WEEKS } from '../game/board';
import { currentWageBill } from '../game/finance';
import { gs } from '../game/state';
import type { TransferOffer } from '../game/types';
import { money, t } from '../i18n';
import { Modal } from './components';
import { useNav } from './core';

export function AcceptCounterButton({ o, onOk }: { o: TransferOffer; onOk: () => void }) {
  const [over, setOver] = useState(false);
  const { nav } = useNav();
  const accept = () => {
    const r = act<string>({ t: 'acceptCounter', pid: o.player });
    if (r === 'ok') { setOver(false); onOk(); } else if (r === 'transfer.overBudget') setOver(true);
  };
  const g = gs();
  const club = g.clubs[g.userClub];
  const counter = o.counter ?? 0;
  const missing = Math.max(0, counter - (club?.transferBudget ?? 0));
  // 1 € ugeløn = SHIFT_WEEKS € transferbudget (samme kurs som på økonomisiden)
  const weekly = Math.ceil(missing / SHIFT_WEEKS / 100) * 100;
  const spare = club ? club.wageBudget - currentWageBill(club.id) : 0;
  return (
    <>
      <button className="small primary" onClick={accept}>{t('offer.acceptCounter')}</button>
      {/* tegnes uden for tabelcellen (som ikke ombryder tekst) */}
      {over && club && createPortal(
        <Modal title={t('counter.overTitle')} onClose={() => setOver(false)}>
          <div className="col">
            <div className="insight warn">{t('counter.overText', { fee: money(counter), budget: money(club.transferBudget), missing: money(missing) })}</div>
            {weekly <= spare ? (
              <div className="row">
                <span className="grow">{t('counter.shiftText', { missing: money(missing), weekly: money(weekly), spare: money(spare) })}</span>
                <button className="primary" onClick={() => { act({ t: 'budgetShift', toWage: false, amount: weekly }); accept(); }}>{t('counter.shiftAccept')}</button>
              </div>
            ) : <div className="muted">{t('counter.noShift', { weekly: money(weekly), spare: money(Math.max(0, spare)) })}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => { setOver(false); nav({ name: 'finance' }); }}>{t('counter.askBoard')}</button>
              <button onClick={() => setOver(false)}>{t('common.close')}</button>
            </div>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
