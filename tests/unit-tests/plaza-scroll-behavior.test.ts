import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';

import { isPlazaScrolledNearBottom } from '../../frontend/src/lib/circle/plazaScroll';

describe('Plaza scroll behavior', () => {
  it('treats the viewport as bottom-pinned when it is within the follow threshold', () => {
    assert.equal(
      isPlazaScrolledNearBottom({
        scrollTop: 428,
        clientHeight: 300,
        scrollHeight: 780,
      }),
      true,
    );
  });

  it('does not treat the viewport as bottom-pinned when the reader has scrolled far upward', () => {
    assert.equal(
      isPlazaScrolledNearBottom({
        scrollTop: 40,
        clientHeight: 300,
        scrollHeight: 780,
      }),
      false,
    );
  });
});
