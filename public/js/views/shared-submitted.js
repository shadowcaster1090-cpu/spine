import { toast } from '../ui.js';
// After a submission: live straight away, or waiting for a moderator.
export function submitted(el, r, link, go, backLabel = 'Back') {
  if (r.status === 'approved') { toast('Saved to the register'); go(link); return; }
  el.innerHTML = `<div class="wrap" style="max-width:720px"><div class="colhead"><div><div class="eyebrow">Submission #${r.id}</div><h1 class="big">Sent for review.</h1></div></div>
    <p class="prose">A moderator will check it shortly. You’ll get a notification when it is approved or if they have a question. Members whose contributions are approved ten times skip the queue.</p>
    <div class="btns" style="margin:24px 0 60px"><a class="btn primary" href="${link}">${backLabel}</a><a class="btn" href="/contributions">My contributions</a></div></div>`;
}
