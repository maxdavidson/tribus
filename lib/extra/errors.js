export class UnimplementedMethodError extends Error {

    get name() {
        return 'UnimplementedMethod';
    }

    constructor(message = 'Method not implemented!') {
        super(message);
    }
}
