function orderAdminNavigation() {
  const links = [...document.querySelectorAll("aside .nav")];
  const users = links.find((item) => item.dataset.view === "users");
  const profile = links.find((item) => item.dataset.view === "profile" && item.classList.contains("sub"));
  if (users && profile) users.after(profile);
}
setTimeout(orderAdminNavigation, 250);
