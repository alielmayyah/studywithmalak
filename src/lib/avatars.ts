export const avatarUrl = (name: string) =>
  `${import.meta.env.BASE_URL}avatars/${name === "Malak" ? "malak-pink.png" : "ali.webp"}`;
