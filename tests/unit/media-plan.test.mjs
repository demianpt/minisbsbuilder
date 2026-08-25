import { describe, expect, it } from 'vitest';
import {
  assignMedia,
  isPeopleFamily,
  mediaQueriesFromBrief,
  parseMediaAssignment,
  parseMediaQueries,
  slotPrefersVideo,
} from '../../shared/brief/media.mjs';

function slot(key, family, role, index, allowsVideo = true) {
  return { key, sectionId: key.split(':')[0], family, role, index, label: '', allowsVideo };
}

function asset(id, kind = 'image') {
  return { id, assetId: id.replace(/\D+/g, ''), kind, src: `https://example.test/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`, alt: id };
}

describe('media search phrases', () => {
  it('describes the subject rather than echoing the brief', () => {
    const queries = mediaQueriesFromBrief({
      industry: 'A championship golf course and clubhouse in Surrey',
      offer: 'Membership, visitor rounds and corporate days',
      keywords: 'fairway, greens',
    });
    expect(queries.images).toMatch(/golf|course|clubhouse/);
    // Footage needs a motion word or a photograph search returns static clips.
    expect(queries.videos).toMatch(/aerial/);
  });

  it('keeps the phrase short, because the library needs every word to match', () => {
    // Four specific words returns zero results where three returns hundreds, so
    // the deterministic phrase must never be the long one.
    for (const brief of [
      { industry: 'A championship golf course and clubhouse in Surrey', offer: 'Membership, visitor rounds and corporate days', keywords: 'fairway, greens, sunrise, premium' },
      { industry: 'Family dental practice offering routine cosmetic and emergency care', offer: 'Gentle judgement-free dentistry with fixed pricing', keywords: 'gentle, modern, reassuring' },
    ]) {
      const queries = mediaQueriesFromBrief(brief);
      expect(queries.images.split(' ').length).toBeLessThanOrEqual(3);
      expect(queries.videos.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('never returns an empty phrase, even from an empty brief', () => {
    expect(parseMediaQueries(mediaQueriesFromBrief({})).images.length).toBeGreaterThan(2);
  });

  it('repairs the shapes the hosted model actually answers with', () => {
    const parsed = parseMediaQueries({ imageQuery: ['golf', 'course', 'sunrise'], footage: 'golf aerial drone' });
    expect(parsed.images).toBe('golf course sunrise');
    expect(parsed.videos).toBe('golf aerial drone');
  });
});

describe('media slots', () => {
  it('asks for video only on a hero or a full-height call to action', () => {
    expect(slotPrefersVideo(slot('s1:background:0', 'hero', 'background', 0))).toBe(true);
    expect(slotPrefersVideo(slot('s2:background:0', 'cta', 'background', 0))).toBe(true);
    expect(slotPrefersVideo(slot('s3:card:0', 'cards', 'card', 0))).toBe(false);
    expect(slotPrefersVideo(slot('s4:feature:0', 'split', 'feature', 0))).toBe(false);
  });

  it('never asks for video in a slot that cannot hold one', () => {
    expect(slotPrefersVideo(slot('s1:background:0', 'hero', 'background', 0, false))).toBe(false);
  });

  it('keeps people out of the stock search', () => {
    expect(isPeopleFamily('team')).toBe(true);
    expect(isPeopleFamily('testimonial')).toBe(true);
    expect(isPeopleFamily('cards')).toBe(false);
  });
});

describe('assigning assets to slots', () => {
  const slots = [
    slot('s1:background:0', 'hero', 'background', 0),
    slot('s2:feature:0', 'split', 'feature', 0),
    slot('s3:card:0', 'cards', 'card', 0),
    slot('s3:card:1', 'cards', 'card', 1),
  ];
  const assets = [asset('ss-image-1'), asset('ss-image-2'), asset('ss-image-3'), asset('ss-video-9', 'video')];

  it('places every slot without using one asset twice', () => {
    const plan = assignMedia({ slots, assets });
    expect(plan.assignments).toHaveLength(4);
    expect(new Set(plan.assignments.map((entry) => entry.assetId)).size).toBe(4);
    expect(plan.unassigned).toEqual([]);
  });

  it('spends the clip on the hero rather than a card', () => {
    const plan = assignMedia({ slots, assets });
    const hero = plan.assignments.find((entry) => entry.slotKey === 's1:background:0');
    expect(hero.assetId).toBe('ss-video-9');
  });

  it('honours the model when it is legal', () => {
    const plan = assignMedia({
      slots,
      assets,
      preferred: [{ slot: 's3:card:1', asset: 'ss-image-1', reason: 'matches the card' }],
    });
    expect(plan.assignments.find((entry) => entry.slotKey === 's3:card:1').assetId).toBe('ss-image-1');
    expect(new Set(plan.assignments.map((entry) => entry.assetId)).size).toBe(plan.assignments.length);
  });

  it('drops a repeat the model asked for rather than showing one picture twice', () => {
    const plan = assignMedia({
      slots,
      assets,
      preferred: [
        { slot: 's3:card:0', asset: 'ss-image-1' },
        { slot: 's3:card:1', asset: 'ss-image-1' },
      ],
    });
    const cards = plan.assignments.filter((entry) => entry.slotKey.startsWith('s3:'));
    expect(cards.map((entry) => entry.assetId)).not.toEqual(['ss-image-1', 'ss-image-1']);
    expect(new Set(plan.assignments.map((entry) => entry.assetId)).size).toBe(plan.assignments.length);
  });

  it('refuses a clip in a slot that cannot hold one', () => {
    const stillOnly = [slot('s5:card:0', 'cards', 'card', 0, false)];
    const plan = assignMedia({
      slots: stillOnly,
      assets: [asset('ss-video-9', 'video')],
      preferred: [{ slot: 's5:card:0', asset: 'ss-video-9' }],
    });
    expect(plan.assignments).toEqual([]);
    expect(plan.unassigned).toEqual(['s5:card:0']);
  });

  it('ignores ids the model invented', () => {
    const plan = assignMedia({ slots, assets, preferred: [{ slot: 's1:background:0', asset: 'ss-image-does-not-exist' }] });
    expect(plan.assignments.every((entry) => assets.some((item) => item.id === entry.assetId))).toBe(true);
  });

  it('leaves slots empty rather than repeating when assets run short', () => {
    const plan = assignMedia({ slots, assets: [asset('ss-image-1')] });
    expect(plan.assignments).toHaveLength(1);
    expect(plan.unassigned).toHaveLength(3);
  });

  it('repairs the assignment shapes the model answers with', () => {
    const parsed = parseMediaAssignment({ plan: [{ key: 's1:background:0', assetId: 'ss-image-1', why: 'establishes the place' }] });
    expect(parsed.assignments).toEqual([{ slot: 's1:background:0', asset: 'ss-image-1', reason: 'establishes the place' }]);
  });
});
