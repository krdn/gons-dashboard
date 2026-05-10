export type Host = {
  id: string;
  name: string;
  dockerContext: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
};
