export type CircleIdentityLevelValue = 'Visitor' | 'Initiate' | 'Member' | 'Elder';

export type CircleRoleValue = 'Owner' | 'Admin' | 'Moderator' | 'Member';

export type ViewerIdentityState = 'visitor' | 'initiate' | 'member' | 'curator' | 'owner';

export type CircleMembershipSourceValue = 'current_circle' | 'inherited_parent' | 'none';

export type CircleIdentityDisplayState =
    | 'observer'
    | 'participant'
    | 'contributor'
    | 'senior_contributor'
    | 'not_joined'
    | 'unknown';
