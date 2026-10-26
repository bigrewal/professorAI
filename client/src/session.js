export const session = {
  autoplay: false,
};

export function requestAutoplay() {
  session.autoplay = true;
}

export function consumeAutoplay() {
  const shouldPlay = session.autoplay;
  session.autoplay = false;
  return shouldPlay;
}
