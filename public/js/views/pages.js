import { setTitle } from '../ui.js';

// Placeholder legal copy: have it reviewed before launch.
const PAGES = {
  about: ['About Spine', `<p>Spine is a film diary joined to a register of DVD editions, kept by the people who collect them. Log what you watch and whether it was your own disc, follow friends to see what they watch and own, and keep the shelf in your pocket. Films are only half the story: the label, the spine number, the region, the transfer and the supplements are what make one disc different from another, and that is what Spine records.</p>
    <h2>Streaming</h2><p>Netflix, Prime Video and the others don't share what you watch with other apps. Spine imports the viewing-history file they let you download, or a live feed from Trakt, and asks you to rate what it finds.</p>
    <h2>How the register works</h2><p>Anyone with an account can add an edition or suggest a correction. Moderators review new members’ contributions; after ten approved contributions your edits go live straight away. Every change is kept in each edition’s history.</p>
    <h2>Covers</h2><p>Cover images are photos members take of their own copies. Until someone uploads one, Spine draws a placeholder cover from the film’s details.</p>`],
  guidelines: ['Contributor guide', `<p>Copy what is printed on the case and disc. If something is not printed, leave it blank rather than guessing.</p>
    <h2>One edition, one entry</h2><p>A different label, region, catalogue number, disc count or packaging makes a separate edition. A reprint with identical contents and barcode is the same edition; mention reprints in the notes.</p>
    <h2>Regions and standards</h2><p>Use the region number on the case. Use 0 for discs marked region-free or “ALL”. Several regions are written 2,4. PAL or NTSC is usually printed near the region logo.</p>
    <h2>Supplements</h2><p>One per line, in the order the case lists them. Include running times when printed.</p>
    <h2>Photos</h2><p>Upload only photos or scans you made yourself. Straighten and crop them to the case.</p>`],
  privacy: ['Privacy', `<p>Spine stores your username, email address, a hashed password, and what you choose to add: your diary, collection, wantlist, watchlist, reviews, lists, contributions and photos. If you connect Trakt, Spine stores the access token Trakt issues and the movie history it returns; viewing-history files you import are read once and not kept. Sign-in uses a single cookie; there are no tracking or advertising cookies.</p>
    <h2>Who can see what</h2><p>Your username, reviews, public lists and contributions are public. Your diary, watchlist and likes are public unless you make your diary private, and your collection and wantlist are public unless you make your collection private, both in settings. Your email address is visible only to you and administrators.</p>
    <h2>Your rights</h2><p>You can download all of your data, or delete your account, from settings at any time. Deleting your account removes your personal data; catalogue entries you added remain without your name.</p>
    <p class="dim">Placeholder policy: have it reviewed for your jurisdiction before launch.</p>`],
  terms: ['Terms', `<p>Be accurate and be kind. Contributions to the catalogue are shared with every member and can be edited by others. Do not upload images you did not make, or anything unlawful.</p>
    <p>Moderators may edit or remove contributions that are inaccurate, duplicated or break these terms, and may suspend accounts that repeatedly do so.</p>
    <p class="dim">Placeholder terms: have them reviewed for your jurisdiction before launch.</p>`]
};

export default async function ({ el, params }) {
  const [title, body] = PAGES[params.page];
  setTitle(title);
  el.innerHTML = `<div class="wrap"><div class="colhead"><div><h1 class="big">${title}</h1></div></div><div class="prose" style="padding-bottom:60px">${body}</div></div>`;
}
