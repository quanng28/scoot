// Browser geometry/interaction checks for the shipped HTML, not physical iPhone acceptance.
import { mkdir } from 'node:fs/promises';

export async function verifyResponsiveSelection({ page, base, log }) {
  const sizes = [
    { name: 'phone-small', width: 375, height: 667 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'phone-large', width: 430, height: 932 },
    { name: 'phone-landscape', width: 844, height: 390 },
    { name: 'desktop-compact', width: 706, height: 774 },
    { name: 'desktop-wide', width: 1440, height: 1000 },
  ];
  await mkdir('test-results/responsive', { recursive: true });
  const results = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(base);
    await page.locator('.exercise-card').last().waitFor();
    if (await page.locator('.exercise-card').count() !== 6) throw new Error(`${size.name}: six exercise cards are not available`);
    if (await page.locator('#btn-confirm-exercise').isVisible()) throw new Error(`${size.name}: Continue appeared without explicit exercise selection`);
    if (await page.locator('.exercise-select[aria-pressed=true]').count()) throw new Error(`${size.name}: an exercise was selected without user input`);
    if (await page.locator('.safari-phone, .safari-bottom-bar, .safari-url-pill').count()) throw new Error(`${size.name}: imitation device/browser elements remain`);
    if (await page.locator('button button').count()) throw new Error(`${size.name}: selection/Continue uses invalid nested buttons`);
    if (await page.locator('#settings-panel').isVisible()) throw new Error(`${size.name}: settings occupy the exercise page by default`);
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell'), box = shell.getBoundingClientRect(), style = getComputedStyle(shell);
      return { x: box.x, width: box.width, radius: parseFloat(style.borderTopLeftRadius), border: parseFloat(style.borderLeftWidth),
        documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, camera: document.querySelector('#live-video').srcObject !== null,
        bodyText: document.body.innerText };
    });
    if (geometry.documentWidth > size.width + 1) throw new Error(`${size.name}: horizontal overflow (${geometry.documentWidth}px)`);
    if (geometry.camera) throw new Error(`${size.name}: camera started without Continue`);
    if (geometry.radius || geometry.border) throw new Error(`${size.name}: simulated device border/corners remain`);
    if (size.width <= 430 && (Math.abs(geometry.x) > 1 || Math.abs(geometry.width - size.width) > 1)) throw new Error(`${size.name}: mobile application does not fill its viewport`);
    if (size.width >= 706 && geometry.width < Math.min(size.width, 1000) - 1) throw new Error(`${size.name}: desktop remains constrained to a phone column`);
    if (geometry.bodyText.includes('Voice and optional Gemini')) throw new Error(`${size.name}: provider configuration remains in the main flow`);
    await page.screenshot({ path: `test-results/responsive/${size.name}-initial.png` });

    if (await page.locator('#btn-scroll-exercises').count()) throw new Error(`${size.name}: removed scroll arrow is still present`);
    await page.locator('.exercise-card').last().scrollIntoViewIfNeeded();
    if (await page.evaluate(() => document.querySelector('#live-video').srcObject !== null)) throw new Error(`${size.name}: ordinary scrolling opened the camera`);
    await page.screenshot({ path: `test-results/responsive/${size.name}-remaining.png` });
    // Every card stays reachable and clickable; fixed controls must not cover a card's hit target.
    for (const select of await page.locator('.exercise-select').all()) {
      await select.scrollIntoViewIfNeeded();
      const hit = await select.evaluate((button) => {
        const b = button.getBoundingClientRect(), target = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return target !== null && button.contains(target);
      });
      if (!hit) throw new Error(`${size.name}: an exercise is covered by another control`);
    }

    const first = page.locator('.exercise-select[data-exercise-id="seated_forward_reach"]');
    await first.click();
    const next = page.locator('#btn-confirm-exercise');
    await next.waitFor({ state: 'visible' });
    if (await next.evaluate((button) => button.closest('.exercise-card') !== null)) throw new Error(`${size.name}: Continue remains inside an exercise card`);
    if (!(await next.getAttribute('aria-label'))?.includes('Seated Forward Reach')) throw new Error(`${size.name}: Continue is not bound to the selected exercise`);
    const nextBox = await next.boundingBox();
    const position = await next.evaluate((button) => getComputedStyle(button).position);
    if (!nextBox || position !== 'fixed' || nextBox.x < size.width / 2 || nextBox.x + nextBox.width > size.width || nextBox.y + nextBox.height > size.height || nextBox.y + nextBox.height < size.height - 60) throw new Error(`${size.name}: Continue is not positioned safely at the viewport bottom-right`);
    await page.screenshot({ path: `test-results/responsive/${size.name}-selected.png` });
    const last = page.locator('.exercise-select[data-exercise-id="seated_ankle_pumps"]');
    await last.click();
    if (!(await next.getAttribute('aria-label'))?.includes('Ankle Pumps')) throw new Error(`${size.name}: Continue retained a previous exercise`);
    if (await page.locator('#btn-confirm-exercise').count() !== 1) throw new Error(`${size.name}: multiple Continue buttons exist`);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const [lastBox, floatingBox] = await Promise.all([last.boundingBox(), next.boundingBox()]);
    if (!lastBox || !floatingBox || lastBox.y + lastBox.height > floatingBox.y - 4) throw new Error(`${size.name}: floating Continue covers the final exercise`);
    await page.locator('#btn-sessions').click();
    await page.locator('#sessions-heading').waitFor({ state: 'visible' });
    if (await next.isVisible()) throw new Error(`${size.name}: selection Continue remains over saved sessions`);
    await page.locator('#btn-close-sessions').click();


    await page.locator('#btn-settings').click();
    await page.locator('#settings-panel').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#settings-panel').waitFor({ state: 'hidden' });
    if (await page.evaluate(() => document.activeElement?.id) !== 'btn-settings') throw new Error(`${size.name}: Settings did not return keyboard focus to its trigger`);
    // Native dialog close dispatch/focus restoration settles in the next rendering turn.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await first.focus();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-exercise-id') === 'seated_forward_reach');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#btn-confirm-exercise')?.getAttribute('aria-label')?.includes('Seated Forward Reach')).catch(async (error) => { throw new Error(`${size.name}: keyboard selection failed; ${JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML, selected: document.querySelector('.exercise-select[aria-pressed=true]')?.dataset.exerciseId, continuation: document.querySelector('#btn-confirm-exercise')?.outerHTML })))}`, { cause: error }); });
    // The fixed action sits outside the cards in document order and remains keyboard reachable.
    let reachedContinue = await page.evaluate(() => document.activeElement?.id) === 'btn-confirm-exercise';
    for (let step = 0; !reachedContinue && step < 10; step++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.id) === 'btn-confirm-exercise') { reachedContinue = true; break; }
    }
    if (!reachedContinue) throw new Error(`${size.name}: keyboard cannot reach Continue after selecting an exercise`);
    results.push({ ...size, fillsViewport: true, noHorizontalOverflow: true, noScrollArrow: true, bottomRightContinue: true, keyboard: true });
    log(`PASS responsive ${size.name} ${size.width}×${size.height}: viewport layout, all-six reachability, no scroll arrow, bottom-right Continue and keyboard/settings focus`);
  }
  return { viewports: results, physicalIPhone: 'not tested' };
}
