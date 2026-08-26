Capitol favicon — blue left / red right

Drop these in your site root, then add to <head>:

  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">

Modern browsers use favicon.svg (sharp at any size); the PNGs are fallbacks.
For a legacy favicon.ico, run favicon-48.png through any ICO packer.
