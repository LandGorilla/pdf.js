export class PDFRightSidebar {
  constructor(options) {
    this.outerContainer = options.outerContainer;
    this.rightSidebarContainer = options.rightSidebarContainer;
    this.rightSidebarResizer = options.rightSidebarResizer;

    // Flags and cached info for resizing.
    this.isResizingRight = false;
    this.startX = 0;
    this.startWidth = 0;

    this.MIN_WIDTH = 100; // or whatever minimum you prefer
    this.MAX_WIDTH = 600; // or whatever maximum you prefer

    this._bindEvents();
  }

  _bindEvents() {
    // 1) When user clicks and holds on the resizer
    this.rightSidebarResizer.addEventListener("mousedown", evt => {
      evt.preventDefault();

      this.isResizingRight = true;
      // Store the initial mouse position
      this.startX = evt.clientX;
      // Store the current width of the sidebar
      this.startWidth = parseFloat(
        window.getComputedStyle(this.rightSidebarContainer).width
      );

      // Optionally add a class to show “resizing in progress”
      this.outerContainer.classList.add("sidebarResizingRight");
    }, true);

    // 2) When user moves the mouse (while holding click)
    document.addEventListener("mousemove", evt => {
      if (!this.isResizingRight) {
        return;
      }

      // Calculate how far the mouse has moved since the initial click
      const dx = evt.clientX - this.startX;
      // For a right sidebar, we want the width to *decrease* if the mouse goes to the left
      let newWidth = this.startWidth - dx;

      // Constrain the width within the min/max
      if (newWidth < this.MIN_WIDTH) {
        newWidth = this.MIN_WIDTH;
      } else if (newWidth > this.MAX_WIDTH) {
        newWidth = this.MAX_WIDTH;
      }

      // Apply the new width
      this.rightSidebarContainer.style.width = newWidth + "px";
      // If you rely on a CSS custom property, set it too:
      this.outerContainer.style.setProperty("--right-sidebar-width", `${newWidth}px`);
    }, true);

    // 3) When user releases the mouse
    document.addEventListener("mouseup", () => {
      if (!this.isResizingRight) {
        return;
      }
      this.isResizingRight = false;
      // Remove the “resizing in progress” class
      this.outerContainer.classList.remove("sidebarResizingRight");
    }, true);
  }
}