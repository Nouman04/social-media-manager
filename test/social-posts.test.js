'use strict';

/**
 * Self-check for how Meta's post / comment payloads become what the posts
 * page shows: reaction counts per type, the Page's own like, comment counts.
 * Run: node test/social-posts.test.js
 */
const assert = require('assert');
const { _fbPost: fbPost, _igPost: igPost, _fbComment: fbComment } = require('../src/services/socialPostService');

// ── Facebook post: aliased reaction edges → one breakdown ───────────────────
const fb = fbPost({
  id: '123_456',
  message: 'Eid offer',
  full_picture: 'https://x/img.jpg',
  created_time: '2026-10-01T10:00:00+0000',
  comments: { summary: { total_count: 3 } },
  reactions: { summary: { total_count: 7, viewer_reaction: 'LIKE' } },
  r_like: { summary: { total_count: 4 } },
  r_love: { summary: { total_count: 2 } },
  r_haha: { summary: { total_count: 1 } },
});
assert.strictEqual(fb.reactions.total, 7);
assert.deepStrictEqual([fb.reactions.LIKE, fb.reactions.LOVE, fb.reactions.HAHA, fb.reactions.SAD], [4, 2, 1, 0]);
assert.strictEqual(fb.comments_count, 3);
assert.strictEqual(fb.viewer_reaction, 'LIKE', "the Page's own like is surfaced");
assert.strictEqual(fb.can_react, true);

const fbNone = fbPost({ id: '1_2', reactions: { summary: { total_count: 0, viewer_reaction: 'NONE' } } });
assert.strictEqual(fbNone.viewer_reaction, null, 'NONE means not liked');
assert.strictEqual(fbNone.comments_count, 0);
assert.strictEqual(fbNone.media_type, 'TEXT');

// ── Instagram post: likes only, video shows its thumbnail ───────────────────
const ig = igPost({ id: '1789', media_type: 'VIDEO', media_url: 'v.mp4', thumbnail_url: 't.jpg', like_count: 12, comments_count: 0 });
assert.strictEqual(ig.image_url, 't.jpg');
assert.deepStrictEqual([ig.reactions.total, ig.comments_count, ig.can_react], [12, 0, false]);

// ── Facebook comment with a reply ───────────────────────────────────────────
const c = fbComment({
  id: '9', message: 'Price?', from: { name: 'Ali' }, like_count: 1, user_likes: true,
  comments: { data: [{ id: '10', message: 'DM sent', from: { name: 'Page' }, like_count: 0 }] },
});
assert.deepStrictEqual([c.author, c.liked_by_page, c.replies.length, c.replies[0].liked_by_page], ['Ali', true, 1, false]);

console.log('social-posts: all checks passed');
