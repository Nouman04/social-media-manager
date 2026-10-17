'use strict';

const axios = require('axios');
const { InstagramDetail, MessengerDetail } = require('../../models');
const { resolveAccount } = require('../helpers/accountHelper');
const { _graphBase: graphBase } = require('./instagramService');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const PLATFORMS = ['instagram', 'facebook'];
const FILTERS = ['all', 'commented', 'uncommented'];
// Every reaction type Facebook reports; Instagram only has likes.
const FB_REACTIONS = ['LIKE', 'LOVE', 'CARE', 'HAHA', 'WOW', 'SAD', 'ANGRY'];
// Graph ids are digits, Page post ids are "<pageId>_<postId>".
const OBJECT_ID_RE = /^\d+(_\d+)?$/;
// Meta "permission missing" error codes (283 = "Requires pages_read_engagement").
const PERMISSION_CODES = [10, 100, 190, 200, 283];

const fail = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

/**
 * Turn a Graph API failure into an Error with statusCode + metaError, and say
 * what to fix when it is the usual missing-permission case.
 */
const metaError = (apiErr, platform) => {
  const data = apiErr?.response?.data?.error || {};
  let message = data.message || apiErr.message;
  if (PERMISSION_CODES.includes(data.code) && /permission|pages_read|instagram_/i.test(message)) {
    message += platform === 'facebook'
      ? ' — add pages_read_engagement, pages_read_user_content and pages_manage_engagement to the Facebook Login configuration, then reconnect the Page.'
      : ' — the Instagram connection needs instagram_basic and instagram_manage_comments; reconnect the account.';
  }
  const err = new Error(message);
  err.statusCode = apiErr?.response?.status || 502;
  err.metaError = data;
  return err;
};

const checkPlatform = (platform) => {
  if (!PLATFORMS.includes(platform)) throw fail(400, 'platform must be instagram or facebook');
};

/** The connected account to read through: an Instagram account, or a Facebook Page. */
const account = (businessId, platform, accountId) => (platform === 'instagram'
  ? resolveAccount(InstagramDetail, businessId, accountId, 'Instagram')
  : resolveAccount(MessengerDetail, businessId, accountId, 'Facebook Page'));

const get = async (url, params, platform) => {
  try {
    const { data } = await axios.get(url, { params });
    return data;
  } catch (apiErr) {
    throw metaError(apiErr, platform);
  }
};

/** Cursor for the next page, only when Meta says there is one. */
const nextCursor = (data) => (data?.paging?.next ? data.paging.cursors?.after || null : null);

// ── normalisers: both platforms answer in one shape ─────────────────────────

const igPost = (m) => ({
  id: m.id,
  platform: 'instagram',
  caption: m.caption || '',
  media_type: m.media_type,
  image_url: m.media_type === 'VIDEO' ? (m.thumbnail_url || null) : (m.media_url || null),
  permalink: m.permalink,
  created_at: m.timestamp,
  comments_count: m.comments_count || 0,
  reactions: { total: m.like_count || 0, LIKE: m.like_count || 0 },
  viewer_reaction: null, // Instagram's API does not expose or allow the account's own like
  can_react: false,
});

const fbPost = (p) => {
  const reactions = { total: p.reactions?.summary?.total_count || 0 };
  FB_REACTIONS.forEach((t) => { reactions[t] = p[`r_${t.toLowerCase()}`]?.summary?.total_count || 0; });
  const viewer = p.reactions?.summary?.viewer_reaction;
  return {
    id: p.id,
    platform: 'facebook',
    caption: p.message || '',
    media_type: p.full_picture ? 'IMAGE' : 'TEXT',
    image_url: p.full_picture || null,
    permalink: p.permalink_url,
    created_at: p.created_time,
    comments_count: p.comments?.summary?.total_count || 0,
    reactions,
    viewer_reaction: viewer && viewer !== 'NONE' ? viewer : null,
    can_react: true,
  };
};

const igComment = (c) => ({
  id: c.id,
  text: c.text || '',
  author: c.username || c.from?.username || null,
  created_at: c.timestamp,
  like_count: c.like_count || 0,
  liked_by_page: null,
  can_react: false,
  replies: (c.replies?.data || []).map(igComment),
});

const fbComment = (c) => ({
  id: c.id,
  text: c.message || '',
  author: c.from?.name || null,
  created_at: c.created_time,
  like_count: c.like_count || 0,
  liked_by_page: Boolean(c.user_likes),
  can_react: true,
  replies: (c.comments?.data || []).map(fbComment),
});

const socialPostService = {

  /**
   * One page of posts from a connected Instagram account or Facebook Page,
   * newest first, each with comment and reaction counts.
   *
   * filter: all | commented | uncommented. Meta can't filter by comments, so
   * it is applied to each fetched page — a page can come back short (even
   * empty) while `next` still points at more posts.
   */
  listPosts: async (businessId, { platform, accountId = null, filter = 'all', after = null, limit = 12 } = {}) => {
    checkPlatform(platform);
    if (!FILTERS.includes(filter)) throw fail(400, `filter must be one of: ${FILTERS.join(', ')}`);
    const detail = await account(businessId, platform, accountId);
    const pageSize = Math.min(Math.max(Number(limit) || 12, 1), 50);

    let data;
    let posts;
    if (platform === 'instagram') {
      data = await get(`${graphBase(detail.access_token)}/${detail.ig_user_id}/media`, {
        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
        limit: pageSize,
        ...(after ? { after } : {}),
        access_token: detail.access_token,
      }, platform);
      posts = (data.data || []).map(igPost);
    } else {
      // One aliased reactions edge per type gives the full breakdown in one call;
      // summary(viewer_reaction) says whether the Page itself has liked it.
      const perType = FB_REACTIONS
        .map((t) => `reactions.type(${t}).limit(0).summary(total_count).as(r_${t.toLowerCase()})`)
        .join(',');
      data = await get(`${FB_GRAPH}/${detail.page_id}/published_posts`, {
        fields: `id,message,full_picture,permalink_url,created_time,comments.limit(0).summary(true),reactions.limit(0).summary(total_count,viewer_reaction),${perType}`,
        limit: pageSize,
        ...(after ? { after } : {}),
        access_token: detail.access_token,
      }, platform);
      posts = (data.data || []).map(fbPost);
    }

    if (filter === 'commented') posts = posts.filter((p) => p.comments_count > 0);
    if (filter === 'uncommented') posts = posts.filter((p) => p.comments_count === 0);

    return {
      platform,
      account: {
        id: detail.id,
        label: platform === 'instagram' ? (detail.username ? `@${detail.username}` : detail.ig_user_id) : (detail.page_name || detail.page_id),
      },
      filter,
      posts,
      next: nextCursor(data),
    };
  },

  /**
   * Comments on one post, each with its replies and like count.
   */
  listComments: async (businessId, postId, { platform, accountId = null, after = null } = {}) => {
    checkPlatform(platform);
    if (!OBJECT_ID_RE.test(String(postId))) throw fail(400, 'Invalid post id.');
    const detail = await account(businessId, platform, accountId);

    let data;
    let comments;
    if (platform === 'instagram') {
      data = await get(`${graphBase(detail.access_token)}/${postId}/comments`, {
        fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}',
        limit: 50,
        ...(after ? { after } : {}),
        access_token: detail.access_token,
      }, platform);
      comments = (data.data || []).map(igComment);
    } else {
      data = await get(`${FB_GRAPH}/${postId}/comments`, {
        fields: 'id,message,from,created_time,like_count,user_likes,comments{id,message,from,created_time,like_count,user_likes}',
        limit: 50,
        order: 'reverse_chronological',
        ...(after ? { after } : {}),
        access_token: detail.access_token,
      }, platform);
      comments = (data.data || []).map(fbComment);
    }

    return { platform, post_id: postId, comments, next: nextCursor(data) };
  },

  /**
   * Comment on a post, or reply to a comment, as the connected account.
   *
   * Instagram: POST /{media}/comments for a post, /{comment}/replies for a
   * reply (replies are one level deep — reply to the top-level comment).
   * Facebook: POST /{post or comment}/comments for both.
   *
   * @param {object} args { platform, accountId, objectId, target: 'post' | 'comment', message }
   * @returns {Promise<object>} the new comment, in the listComments shape
   */
  comment: async (businessId, { platform, accountId = null, objectId, target = 'post', message } = {}) => {
    checkPlatform(platform);
    if (!OBJECT_ID_RE.test(String(objectId || ''))) throw fail(400, 'object_id must be a post or comment id.');
    if (!['post', 'comment'].includes(target)) throw fail(400, 'target must be post or comment');
    const text = String(message || '').trim();
    if (!text) throw fail(400, 'message is required.');
    const max = platform === 'instagram' ? 2200 : 8000; // each platform's own limit
    if (text.length > max) throw fail(400, `message is longer than ${max} characters.`);

    const detail = await account(businessId, platform, accountId);
    const base = platform === 'instagram' ? graphBase(detail.access_token) : FB_GRAPH;
    const edge = platform === 'instagram' && target === 'comment' ? 'replies' : 'comments';

    let data;
    try {
      ({ data } = await axios.post(`${base}/${objectId}/${edge}`, null, {
        params: { message: text, access_token: detail.access_token },
      }));
    } catch (apiErr) {
      throw metaError(apiErr, platform);
    }

    return {
      id: data?.id,
      text,
      author: platform === 'instagram' ? (detail.username ? `@${detail.username}` : 'You') : (detail.page_name || 'You'),
      created_at: new Date().toISOString(),
      like_count: 0,
      liked_by_page: platform === 'facebook' ? false : null,
      can_react: platform === 'facebook',
      replies: [],
    };
  },

  /**
   * Like or unlike a Facebook post or comment as the Page.
   *
   * Facebook's API only lets a Page add a plain Like (other reaction types
   * can be read but not given), and Instagram's API has no like endpoint.
   */
  react: async (businessId, { platform, accountId = null, objectId, action = 'like' } = {}) => {
    checkPlatform(platform);
    if (platform === 'instagram') {
      throw fail(400, "Instagram's API does not allow liking posts or comments — only reading like counts.");
    }
    if (!OBJECT_ID_RE.test(String(objectId || ''))) throw fail(400, 'object_id must be a Facebook post or comment id.');
    if (!['like', 'unlike'].includes(action)) throw fail(400, 'action must be like or unlike');

    const detail = await account(businessId, platform, accountId);
    const url = `${FB_GRAPH}/${objectId}/likes`;
    try {
      const { data } = action === 'like'
        ? await axios.post(url, null, { params: { access_token: detail.access_token } })
        : await axios.delete(url, { params: { access_token: detail.access_token } });
      return { object_id: objectId, action, success: data?.success !== false };
    } catch (apiErr) {
      throw metaError(apiErr, platform);
    }
  },
};

// Exposed for the self-check — the shape the page renders from.
socialPostService._fbPost = fbPost;
socialPostService._igPost = igPost;
socialPostService._fbComment = fbComment;

module.exports = socialPostService;
