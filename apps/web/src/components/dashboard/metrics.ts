/** Shared by the dashboard page (server) and its chart (client): plain data, so it works on both sides. */
export type MetricKey = 'reads' | 'likes' | 'comments' | 'followers' | 'saves' | 'profileViews'
export const METRIC_LABELS: Record<MetricKey, string> = {
  reads: 'Reads',
  likes: 'Likes',
  comments: 'Comments',
  followers: 'New followers',
  saves: 'Saves',
  profileViews: 'Profile views',
}
