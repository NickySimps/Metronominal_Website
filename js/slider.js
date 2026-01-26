
export class Slider {
    constructor(sliderElement, decrementButton, incrementButton, { onValueChange, snapPoints, snapFn, initialValue, onIncrement, onDecrement }) {
        this.sliderElement = sliderElement;
        this.decrementButton = decrementButton;
        this.incrementButton = incrementButton;
        this.onValueChange = onValueChange;
        this.snapPoints = snapPoints;
        this.snapFn = snapFn;
        this.value = initialValue;
        this.onIncrementCallback = onIncrement;
        this.onDecrementCallback = onDecrement;

        this.sliderElement.value = this.value;

        this.sliderElement.addEventListener('input', (e) => {
            let newValue = parseFloat(e.target.value);

            if (this.snapFn) {
                newValue = this.snapFn(newValue);
            } else if (this.snapPoints && this.snapPoints.length > 0) {
                let closest = this.snapPoints[0];
                let minDiff = Math.abs(newValue - closest);

                for (let i = 1; i < this.snapPoints.length; i++) {
                    const diff = Math.abs(newValue - this.snapPoints[i]);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = this.snapPoints[i];
                    }
                }
                newValue = closest;
            }

            this.value = newValue;
            if (this.onValueChange) {
                this.onValueChange(this.value);
            }
        });

        this.decrementButton.addEventListener('click', () => this.decrement());
        this.incrementButton.addEventListener('click', () => this.increment());
    }

    setValue(newValue) {
        this.value = newValue;
        this.sliderElement.value = this.value;
        if (this.onValueChange) {
            this.onValueChange(this.value);
        }
    }

    updateSnapPoints(newSnapPoints) {
        this.snapPoints = newSnapPoints;
    }

    decrement() {
        let newValue;
        if (this.snapPoints && this.snapPoints.length > 0) {
            newValue = this.getPreviousSnapPoint();
        } else if (this.onDecrementCallback) {
            newValue = this.onDecrementCallback(this.value);
        } else {
            newValue = this.value - 1;
        }
        this.setValue(newValue);
    }

    increment() {
        let newValue;
        if (this.snapPoints && this.snapPoints.length > 0) {
            newValue = this.getNextSnapPoint();
        } else if (this.onIncrementCallback) {
            newValue = this.onIncrementCallback(this.value);
        } else {
            newValue = this.value + 1;
        }
        this.setValue(newValue);
    }

    getNextSnapPoint() {
        if (!this.snapPoints || this.snapPoints.length === 0) {
            return this.value;
        }

        let nextValue = this.value;
        for (let i = 0; i < this.snapPoints.length; i++) {
            if (this.snapPoints[i] > this.value) {
                nextValue = this.snapPoints[i];
                break;
            }
        }
        // If the value is already at or past the last snap point, stay there.
        if (nextValue === this.value && this.value >= this.snapPoints[this.snapPoints.length - 1]) {
            return this.snapPoints[this.snapPoints.length - 1];
        }


        return nextValue;
    }

    getPreviousSnapPoint() {
        if (!this.snapPoints || this.snapPoints.length === 0) {
            return this.value;
        }

        let previousValue = this.value;
        for (let i = this.snapPoints.length - 1; i >= 0; i--) {
            if (this.snapPoints[i] < this.value) {
                previousValue = this.snapPoints[i];
                break;
            }
        }

        // If the value is already at or below the first snap point, stay there.
        if (previousValue === this.value && this.value <= this.snapPoints[0]) {
            return this.snapPoints[0];
        }

        return previousValue;
    }
}
