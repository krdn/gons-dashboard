export type Project = {
  id: string;
  hostId: string;
  composeProject: string;
  displayName: string;
  description: string | null;
  category: string | null;
  isPinned: boolean;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
};
