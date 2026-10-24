import type { LiveFailureCode } from '../../community/ports';

export const liveError: Record<LiveFailureCode, string> = {
    invalid_input: 'The server could not validate this input. Review it before trying again.',
    invalid_state: 'This action is no longer available in the current job state. Refresh to check.',
    permission_denied: 'Community access was denied or changed. Retry access or sign out.',
    pending_access: 'Community approval is required. Retry access or sign out.',
    not_found: 'This job is no longer available. Refresh your jobs.',
    conflict: 'Someone else may have changed this job. Refresh to check its current state.',
    unsupported_team: 'Requests needing more than one helper are not supported. This request cannot be posted here.',
    idempotency_conflict: 'The server rejected this retry record. Refresh and check what was saved before discarding it.',
    retry: 'The response could not be verified. You may be offline. Refresh reads or retry the same action.',
    aborted: 'The request was interrupted. It may already have saved on the server. Retry the same action to check.',
    session_changed: 'The account session changed. Recheck sign-in before continuing.',
};
export const liveStatus = { open: 'Open', accepted: 'Accepted', 'on-the-way': 'On the way', arrived: 'Arrived', 'reported-done': 'Reported done — awaiting resident confirmation', completed: 'Completed', cancelled: 'Cancelled' };
export const creditNotice = 'Approved service credit is set by community policy. It is not measured work duration or official school verification.';
export const scopeNotice = 'Live accounts support single-helper requests, assigned-job messages, and approved service credit. Room capture, family accounts and helper teams are not supported here.';
/** Live navigation is explicitly English-only; shared translated dictionaries stay unchanged. */
export const liveCopy = {
    bindingError: 'The current account could not be bound to community access.', profileMismatch: 'The profile and account do not match. Recheck sign-in.',
    empty: 'Nothing here yet.', loading: 'Loading…', realAccount: 'Real community account', welcome: 'Welcome,',
    languageLimit: 'Live navigation is currently in English. Drafts and skill labels use your profile language; other live text is not translated.',
    about: 'Live account scope and retry help',
    leaveNotice: 'Only server-confirmed changes appear as saved. If you leave during a request, it may already have saved. Check your jobs and messages after signing in again.',
    refreshCommunity: 'Retry / refresh community', signOut: 'Sign out', access: 'Community access', pending: 'Awaiting community approval', revoked: 'Community access revoked', unavailable: 'Community access unavailable',
    noApproval: 'Only approved community membership enables requests or volunteering. This app cannot approve your account.', recheckSession: 'Recheck sign-in',
    receipt: 'Action receipt', waiting: 'Waiting for server…', unconfirmed: 'Action not confirmed', action: 'Action:',
    lockedInput: '. The original input is locked. Retrying sends the same action and receipt key, so a lost response does not create a second copy.',
    uncertain: 'It may already have saved. Refreshing only reads the latest state; it never submits again.', retryAction: 'Retry same action', discard: 'Discard retry record',
    discardNotice: 'Discarding does not undo a saved action. Check jobs and messages before creating a replacement.', wait: 'Please wait. Other changes are locked.', approvedRole: 'Approved role:',
    mismatchBefore: 'Your profile role is a preference. Your approved community role is', mismatchAfter: '; this workspace follows that role.',
    discover: 'Discover requests', requests: 'Requests in your community', discoveryNotice: 'Only catalog categories, coarse areas, controlled skills and approved credit appear here. Accepting assigns you to one request and allows private details.',
    refreshDiscovery: 'Refresh discovery', accept: 'Accept request', moreRequests: 'Load more requests', jobs: 'Your jobs', ownRequests: 'Your requests', assigned: 'Your assigned jobs', refreshJobs: 'Refresh jobs',
    viewDetails: 'View job details', moreJobs: 'Load more jobs', selected: 'Selected job', closeDetails: 'Close job details', refreshDetails: 'Refresh job details',
    credit: 'Approved service credit', creditLabel: 'Approved service credit:', creditUnset: 'Not set', creditRefresh: 'Refresh credit ledger', approvedMinutes: 'approved minutes', confirmed: 'Confirmed:', viewCredit: 'View credited job', moreCredit: 'Load more credit',
    draftLabel: 'Draft a request', askOne: 'Ask one helper', draftNotice: 'Type the task in your chosen profile language. A local rules draft needs your review. Only your typed words, the reviewed task and address are sent after you post.',
    request: 'Your request', address: 'Address for the assigned helper', review: 'Review task and address', invalidDraft: 'Enter a task and address within the limits. Attachment data and local file links cannot be sent.',
    invalidPost: 'Review your request. Attachment data and local file links cannot be sent.', reviewLabel: 'Review request', category: 'Category:', people: 'Helpers needed:', estimate: 'Planning estimate:', estimateAfter: 'minutes. The community sets any approved service credit.',
    sharedAddress: 'Address shared with the assigned helper:', privacy: 'Discovery shows a catalog category and coarse area. Your narrative, name and address are available only to the assigned helper and authorized community operations.',
    reviewed: 'I reviewed this task and address and want to post it.', post: 'Post reviewed request',
    privateDetails: 'Private job details', original: 'Your request words:', addressLabel: 'Address:', resident: 'Resident:', helper: 'Assigned helper:', unassigned: 'Not assigned', history: 'Job history',
    onWay: 'Mark on the way', arrived: 'Mark arrived', report: 'Report task done', confirmCheck: 'I confirm this task is complete. This may approve policy service credit.', confirmDone: 'Confirm completed task',
    cancelCheck: 'I want to cancel this request.', cancel: 'Cancel request', rate: 'Rate this completed task', stars: 'Stars', ratingNote: 'Rating note (optional)', saveRating: 'Save rating', savedRating: 'Saved rating:',
    messagesLabel: 'Job messages', messages: 'Messages', refreshMessages: 'Refresh messages', loadingMessages: 'Loading messages…', noMessages: 'No messages yet.', you: 'You', other: 'Other participant', olderMessages: 'Load older messages', message: 'Message', send: 'Send message',
    messageLimit: 'Messaging is available to participants while an assigned task is in progress.',
};
